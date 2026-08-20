import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock Electron so the import doesn't fail at load time
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mock-userdata' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace('enc:', ''),
  },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
}));

import { shell } from 'electron';
import {
  GoogleAuthService,
  createGoogleAuthService,
  getGoogleAuthService,
  resetGoogleAuthService,
} from '@main/services/GoogleAuthService';

const originalFetch = globalThis.fetch;

describe('GoogleAuthService', () => {
  let service: GoogleAuthService;
  let tempDir: string;

  beforeEach(async () => {
    resetGoogleAuthService();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gauth-test-'));
    service = createGoogleAuthService(tempDir);
  });

  afterEach(async () => {
    service.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('pickDocument', () => {
    /**
     * Drives the real loopback callback server the same way Google does:
     * redirect back with an authorization code plus the ids the user picked.
     */
    async function respondOnCallback(query: string): Promise<void> {
      const openExternal = vi.mocked(shell.openExternal);
      // Wait for the flow to open the browser so we know the port.
      for (let i = 0; i < 200 && openExternal.mock.calls.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      const authUrl = new URL(String(openExternal.mock.calls[0]?.[0]));
      const redirectUri = authUrl.searchParams.get('redirect_uri');
      if (!redirectUri) throw new Error('no redirect_uri in auth url');
      await fetch(`${redirectUri}?${query}`);
    }

    beforeEach(() => {
      vi.mocked(shell.openExternal).mockClear();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request) => {
          const url = input instanceof Request ? input.url : input.toString();
          // Let the loopback callback request go to the real server.
          if (url.startsWith('http://localhost:')) {
            return originalFetch(url);
          }
          if (url.includes('oauth2.googleapis.com/token')) {
            return new Response(
              JSON.stringify({
                access_token: 'picked-access',
                refresh_token: 'picked-refresh',
                expires_in: 3600,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (url.includes('userinfo')) {
            return new Response(JSON.stringify({ email: 'picker@example.com' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          throw new Error(`unexpected fetch: ${url}`);
        })
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should return the document id the user picked', async () => {
      const pending = service.pickDocument();
      await respondOnCallback('code=auth-code&picked_file_ids=PICKED_DOC_ID');
      await expect(pending).resolves.toBe('PICKED_DOC_ID');
    });

    it('should return the first id when the callback carries several', async () => {
      const pending = service.pickDocument();
      await respondOnCallback('code=auth-code&picked_file_ids=FIRST_ID,SECOND_ID');
      await expect(pending).resolves.toBe('FIRST_ID');
    });

    it('should return null when the user picks nothing', async () => {
      const pending = service.pickDocument();
      await respondOnCallback('code=auth-code');
      await expect(pending).resolves.toBeNull();
    });
  });

  describe('initial state', () => {
    it('should start as not authenticated', () => {
      const state = service.getAuthState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.userEmail).toBeUndefined();
    });
  });

  describe('initialize', () => {
    it('should be idempotent', async () => {
      await service.initialize();
      await service.initialize();
      // No error thrown, still works
      expect(service.getAuthState().isAuthenticated).toBe(false);
    });

    it('should load saved tokens if they exist', async () => {
      // Manually write an encrypted token file
      const tokens = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_at: Date.now() + 3600 * 1000,
        email: 'user@example.com',
      };
      const tokenPath = path.join(tempDir, 'google-auth-tokens');
      await fs.mkdir(tempDir, { recursive: true });
      // Our mock encryptString prepends "enc:"
      await fs.writeFile(tokenPath, Buffer.from(`enc:${JSON.stringify(tokens)}`));

      await service.initialize();
      const state = service.getAuthState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.userEmail).toBe('user@example.com');
    });

    it('should handle missing token file gracefully', async () => {
      await service.initialize();
      expect(service.getAuthState().isAuthenticated).toBe(false);
    });
  });

  describe('generateAuthUrl', () => {
    it('should produce a valid Google OAuth URL with PKCE params', () => {
      const result = service.generateAuthUrl();
      expect(result.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(result.url).toContain('response_type=code');
      expect(result.url).toContain('code_challenge=');
      expect(result.url).toContain('code_challenge_method=S256');
      expect(result.url).toContain('access_type=offline');
      expect(result.url).toContain('prompt=consent');
      expect(result.codeVerifier).toBeTruthy();
      expect(result.codeVerifier.length).toBeGreaterThan(0);
    });

    it('should not include client_secret in the URL', () => {
      const result = service.generateAuthUrl();
      expect(result.url).not.toContain('client_secret');
    });

    it('should include correct scopes', () => {
      const result = service.generateAuthUrl();
      const url = new URL(result.url);
      const scope = url.searchParams.get('scope');
      expect(scope).toContain('https://www.googleapis.com/auth/drive.file');
      // The sensitive all-your-documents scope must never be requested.
      expect(scope).not.toContain('https://www.googleapis.com/auth/documents');
    });

    it('should not trigger the picker on a plain sign-in', () => {
      const result = service.generateAuthUrl();
      const url = new URL(result.url);
      expect(url.searchParams.get('trigger_onepick')).toBeNull();
    });

    it('should trigger the picker when asked to pick a document', () => {
      const result = service.generateAuthUrl(undefined, { pickDocument: true });
      const url = new URL(result.url);
      expect(url.searchParams.get('trigger_onepick')).toBe('true');
      // The picker rides on the normal consent flow, so this must survive.
      expect(url.searchParams.get('prompt')).toBe('consent');
    });

    it('should request drive.file alone when picking, with no other scope', () => {
      // Google: "Only the drive.file scope is permitted [for the desktop
      // picker] and it can't be combined with any other scope." Sending
      // 'email' alongside it silently suppresses the picker and degrades to
      // an ordinary consent screen.
      const result = service.generateAuthUrl(undefined, { pickDocument: true });
      const scopes = (new URL(result.url).searchParams.get('scope') ?? '').split(' ').filter(Boolean);
      expect(scopes).toEqual(['https://www.googleapis.com/auth/drive.file']);
    });

    it('should use default client ID when none is set', () => {
      const result = service.generateAuthUrl();
      const url = new URL(result.url);
      expect(url.searchParams.get('client_id')).toBe(service.getActiveClientId());
    });

    it('should use provided client ID when passed', () => {
      const customId = 'my-custom-id.apps.googleusercontent.com';
      const result = service.generateAuthUrl(customId);
      const url = new URL(result.url);
      expect(url.searchParams.get('client_id')).toBe(customId);
    });

    it('should include localhost redirect_uri', () => {
      const result = service.generateAuthUrl();
      const url = new URL(result.url);
      const redirectUri = url.searchParams.get('redirect_uri');
      expect(redirectUri).toMatch(/^http:\/\/localhost:\d+\/callback$/);
    });

    it('should generate different code verifiers each time', () => {
      const result1 = service.generateAuthUrl();
      const result2 = service.generateAuthUrl();
      expect(result1.codeVerifier).not.toBe(result2.codeVerifier);
    });
  });

  describe('custom client ID', () => {
    it('should use custom client ID when set', () => {
      const customId = 'custom-id.apps.googleusercontent.com';
      service.setCustomClientId(customId);
      expect(service.getActiveClientId()).toBe(customId);
    });

    it('should revert to default when set to null', () => {
      const customId = 'custom-id.apps.googleusercontent.com';
      service.setCustomClientId(customId);
      service.setCustomClientId(null);
      expect(service.getActiveClientId()).not.toBe(customId);
    });

    it('should use custom client ID in generated auth URL', () => {
      const customId = 'custom-id.apps.googleusercontent.com';
      service.setCustomClientId(customId);
      const result = service.generateAuthUrl();
      const url = new URL(result.url);
      expect(url.searchParams.get('client_id')).toBe(customId);
    });
  });

  describe('signOut', () => {
    it('should clear auth state', async () => {
      // Simulate being signed in by writing tokens and initializing
      const tokens = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_at: Date.now() + 3600 * 1000,
        email: 'user@example.com',
      };
      const tokenPath = path.join(tempDir, 'google-auth-tokens');
      await fs.writeFile(tokenPath, Buffer.from(`enc:${JSON.stringify(tokens)}`));
      await service.initialize();
      expect(service.getAuthState().isAuthenticated).toBe(true);

      await service.signOut();
      expect(service.getAuthState().isAuthenticated).toBe(false);
      expect(service.getAuthState().userEmail).toBeUndefined();
    });

    it('should remove the token file', async () => {
      const tokens = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_at: Date.now() + 3600 * 1000,
        email: 'user@example.com',
      };
      const tokenPath = path.join(tempDir, 'google-auth-tokens');
      await fs.writeFile(tokenPath, Buffer.from(`enc:${JSON.stringify(tokens)}`));
      await service.initialize();

      await service.signOut();

      // Token file should be gone
      await expect(fs.access(tokenPath)).rejects.toThrow();
    });

    it('should not throw if already signed out', async () => {
      await service.initialize();
      await expect(service.signOut()).resolves.not.toThrow();
    });
  });

  describe('getAccessToken', () => {
    it('should throw if not authenticated', async () => {
      await service.initialize();
      await expect(service.getAccessToken()).rejects.toThrow();
    });

    it('should return access token if authenticated and not expired', async () => {
      const tokens = {
        access_token: 'valid-access-token',
        refresh_token: 'test-refresh-token',
        expires_at: Date.now() + 3600 * 1000,
        email: 'user@example.com',
      };
      const tokenPath = path.join(tempDir, 'google-auth-tokens');
      await fs.writeFile(tokenPath, Buffer.from(`enc:${JSON.stringify(tokens)}`));
      await service.initialize();

      const token = await service.getAccessToken();
      expect(token).toBe('valid-access-token');
    });
  });

  describe('singleton', () => {
    it('should return the same instance from getGoogleAuthService', () => {
      const a = getGoogleAuthService();
      const b = getGoogleAuthService();
      expect(a).toBe(b);
      a.destroy();
    });

    it('should reset singleton on resetGoogleAuthService', () => {
      const a = getGoogleAuthService();
      resetGoogleAuthService();
      const b = getGoogleAuthService();
      expect(a).not.toBe(b);
      a.destroy();
      b.destroy();
    });
  });

  describe('destroy', () => {
    it('should not throw when called multiple times', () => {
      service.destroy();
      expect(() => service.destroy()).not.toThrow();
    });
  });
});
