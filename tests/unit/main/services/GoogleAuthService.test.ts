import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock Electron so the import doesn't fail at load time. "enc:" stands in for
// the keychain ciphertext. The sync safeStorage methods are removed in
// Electron 46, so they throw here: any call to them fails the test.
vi.mock('electron', () => {
  const removedInElectron46 = (): never => {
    throw new Error('sync safeStorage API is removed in Electron 46');
  };
  return {
    app: { getPath: () => '/tmp/mock-userdata' },
    safeStorage: {
      isAsyncEncryptionAvailable: vi.fn(() => Promise.resolve(true)),
      encryptStringAsync: vi.fn((s: string) => Promise.resolve(Buffer.from(`enc:${s}`))),
      decryptStringAsync: vi.fn((b: Buffer) =>
        Promise.resolve({ result: b.toString().replace('enc:', ''), shouldReEncrypt: false })
      ),
      isEncryptionAvailable: vi.fn(removedInElectron46),
      encryptString: vi.fn(removedInElectron46),
      decryptString: vi.fn(removedInElectron46),
    },
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  };
});

import http from 'http';
import { safeStorage, shell } from 'electron';
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
    vi.clearAllMocks();
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

    it('should persist tokens encrypted and load them in a fresh service', async () => {
      const pending = service.pickDocument();
      await respondOnCallback('code=auth-code&picked_file_ids=DOC');
      await pending;

      const onDisk = await fs.readFile(path.join(tempDir, 'google-auth-tokens'), 'utf-8');
      expect(onDisk.startsWith('enc:')).toBe(true);

      const reloaded = createGoogleAuthService(tempDir);
      await reloaded.initialize();
      expect(reloaded.getAuthState()).toEqual({
        isAuthenticated: true,
        userEmail: 'picker@example.com',
      });
      await expect(reloaded.getAccessToken()).resolves.toBe('picked-access');
      reloaded.destroy();

      expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
      expect(safeStorage.encryptString).not.toHaveBeenCalled();
      expect(safeStorage.decryptString).not.toHaveBeenCalled();
    });
  });


  describe('when the loopback server cannot listen', () => {
    // Under the macOS App Sandbox, listen() fails with EPERM unless the app
    // carries com.apple.security.network.server. The MAS build did not, and
    // the failure was doubly confusing: the server object was assigned before
    // listen threw, so the *next* attempt saw a live-looking server, skipped
    // startup, and sent Google a redirect_uri on port 0 -- which the browser
    // then refused with ERR_UNSAFE_PORT.
    /** Make http.createServer hand back a server whose listen() is denied. */
    function denyListen(): void {
      vi.spyOn(http, 'createServer').mockImplementation((() => ({
        listen: (): never => {
          const error: NodeJS.ErrnoException = new Error(
            'listen EPERM: operation not permitted 0.0.0.0',
          );
          error.code = 'EPERM';
          throw error;
        },
        address: () => null,
        close: vi.fn(),
        on: vi.fn(),
      })) as unknown as typeof http.createServer);
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('says which entitlement is missing instead of failing opaquely', async () => {
      denyListen();
      await expect(service.pickDocument()).rejects.toThrow(/network\.server/);
    });

    it('never sends Google a redirect on port 0', async () => {
      denyListen();
      vi.mocked(shell.openExternal).mockClear();

      await expect(service.pickDocument()).rejects.toThrow();
      // A second attempt must retry the listen, not reuse a dead server.
      await expect(service.pickDocument()).rejects.toThrow();

      expect(http.createServer).toHaveBeenCalledTimes(2);
      expect(shell.openExternal).not.toHaveBeenCalled();
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

    it('should rewrite the token file when safeStorage asks to re-encrypt', async () => {
      const tokens = { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600 * 1000 };
      const tokenPath = path.join(tempDir, 'google-auth-tokens');
      await fs.writeFile(tokenPath, Buffer.from('old-key-ciphertext'));
      vi.mocked(safeStorage.decryptStringAsync).mockResolvedValueOnce({
        result: JSON.stringify(tokens),
        shouldReEncrypt: true,
      });

      await service.initialize();

      expect(service.getAuthState().isAuthenticated).toBe(true);
      expect(await fs.readFile(tokenPath, 'utf-8')).toBe(`enc:${JSON.stringify(tokens)}`);
    });

    it('should store and load plain JSON when encryption is unavailable', async () => {
      vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(false);
      try {
        const tokens = { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600 * 1000 };
        const tokenPath = path.join(tempDir, 'google-auth-tokens');
        await fs.writeFile(tokenPath, JSON.stringify(tokens), 'utf-8');

        await service.initialize();

        expect(service.getAuthState().isAuthenticated).toBe(true);
        expect(safeStorage.decryptStringAsync).not.toHaveBeenCalled();
      } finally {
        vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(true);
      }
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
