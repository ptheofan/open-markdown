/**
 * GoogleAuthService - OAuth2 + PKCE authentication for Google Docs API
 *
 * Handles the full authentication flow: generating auth URLs, catching the OAuth
 * callback via a local HTTP server, exchanging codes for tokens, storing tokens
 * securely with safeStorage, and auto-refreshing expired tokens.
 */
import crypto from 'crypto';
import http from 'http';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { app, safeStorage, shell } from 'electron';
import type { GoogleAuthState } from '@shared/types/google-docs';

declare const __GOOGLE_OAUTH_CLIENT_ID_ENC__: string;
declare const __GOOGLE_OAUTH_CLIENT_SECRET_ENC__: string;

/** Deobfuscate a build-time encrypted string (AES-256-CBC) */
function deobfuscate(encoded: string): string {
  if (!encoded) return '';
  const [ivHex, encHex] = encoded.split(':');
  if (!ivHex || !encHex) return '';
  const key = crypto.scryptSync('open-markdown-obf', 'docs-salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}

const DEFAULT_CLIENT_ID = deobfuscate(__GOOGLE_OAUTH_CLIENT_ID_ENC__);
const DEFAULT_CLIENT_SECRET = deobfuscate(__GOOGLE_OAUTH_CLIENT_SECRET_ENC__);

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
  'email',
];

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Buffer time before expiry to trigger a refresh (5 minutes) */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  email?: string;
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export class GoogleAuthService {
  private tokenPath: string;
  private tokens: StoredTokens | null = null;
  private initialized = false;
  private customClientId: string | null = null;
  private callbackServer: http.Server | null = null;
  private callbackPort = 0;

  constructor(dataDir?: string) {
    const dir = dataDir ?? app.getPath('userData');
    this.tokenPath = path.join(dir, 'google-auth-tokens');
  }

  /**
   * Initialize the service — loads saved tokens from disk.
   * Idempotent: calling multiple times is safe.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.loadTokens();
    this.initialized = true;
  }

  // ── Auth state ────────────────────────────────────────────

  getAuthState(): GoogleAuthState {
    // If tokens are in memory, we're authenticated
    if (this.tokens) {
      return { isAuthenticated: true, userEmail: this.tokens.email };
    }
    // If not initialized yet, check if token file exists on disk (no keychain access)
    if (!this.initialized) {
      try {
        if (fsSync.existsSync(this.tokenPath)) {
          return { isAuthenticated: true }; // tokens on disk, will load lazily on sync
        }
      } catch {
        // ignore
      }
    }
    return { isAuthenticated: false };
  }

  // ── Auth flow ─────────────────────────────────────────────

  /**
   * Generate a Google OAuth2 authorization URL with PKCE.
   * Optionally override the client ID for this request.
   */
  generateAuthUrl(clientId?: string): { url: string; codeVerifier: string } {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const activeClientId = clientId ?? this.getActiveClientId();

    const params = new URLSearchParams({
      client_id: activeClientId,
      redirect_uri: `http://localhost:${this.callbackPort}/callback`,
      response_type: 'code',
      scope: SCOPES.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });

    return {
      url: `${AUTH_ENDPOINT}?${params.toString()}`,
      codeVerifier,
    };
  }

  /**
   * Full sign-in flow:
   * 1. Generate auth URL with PKCE
   * 2. Open the URL in the system browser
   * 3. Wait for the callback with the authorization code
   * 4. Exchange code for tokens
   * 5. Fetch user email
   * 6. Save tokens
   */
  async signIn(): Promise<GoogleAuthState> {
    await this.initialize();
    // Ensure callback server is running (may have been stopped after previous auth)
    if (!this.callbackServer) {
      this.startCallbackServerSync();
    }

    const { url, codeVerifier } = this.generateAuthUrl();

    // Open in system browser
    await shell.openExternal(url);

    // Wait for the authorization code from the callback server
    console.warn('[GoogleAuth] Waiting for callback...');
    const code = await this.waitForCallback();
    console.warn('[GoogleAuth] Got auth code, exchanging for tokens...');

    // Exchange the code for tokens
    const activeClientId = this.getActiveClientId();
    const tokenResponse = await this.exchangeCode(code, codeVerifier, activeClientId);
    console.warn('[GoogleAuth] Token exchange successful, fetching user email...');

    // Fetch user info to get email
    const email = await this.fetchUserEmail(tokenResponse.access_token);
    console.warn('[GoogleAuth] Got email:', email);

    // Store tokens
    this.tokens = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_at: Date.now() + tokenResponse.expires_in * 1000,
      email,
    };

    await this.saveTokens();
    console.warn('[GoogleAuth] Tokens saved. Auth state:', this.getAuthState());

    return this.getAuthState();
  }

  /**
   * Sign out: clear tokens from memory and disk.
   */
  async signOut(): Promise<void> {
    this.tokens = null;
    try {
      await fs.unlink(this.tokenPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  // ── Token access ──────────────────────────────────────────

  /**
   * Get a valid access token. Auto-refreshes if expired or about to expire.
   * Throws if not authenticated.
   */
  async getAccessToken(): Promise<string> {
    await this.initialize();
    if (!this.tokens) {
      throw new Error('Not authenticated. Call signIn() first.');
    }

    // Check if token needs refreshing
    if (Date.now() >= this.tokens.expires_at - REFRESH_BUFFER_MS) {
      await this.refreshAccessToken();
    }

    return this.tokens.access_token;
  }

  // ── Credential management ─────────────────────────────────

  setCustomClientId(clientId: string | null): void {
    this.customClientId = clientId;
  }

  getActiveClientId(): string {
    return this.customClientId ?? DEFAULT_CLIENT_ID;
  }

  // ── URL parsing ───────────────────────────────────────────

  extractDocId(url: string): string | null {
    const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    return match?.[1] ?? null;
  }

  // ── Cleanup ───────────────────────────────────────────────

  destroy(): void {
    this.stopCallbackServer();
  }

  private stopCallbackServer(): void {
    if (this.callbackServer) {
      this.callbackServer.close();
      this.callbackServer = null;
    }
  }

  // ── Private helpers ───────────────────────────────────────

  /**
   * Start a local HTTP server to receive the OAuth callback.
   * Listens on a random port (port 0).
   */
  private startCallbackServerSync(): void {
    if (this.callbackServer) return;

    this.callbackServer = http.createServer();
    this.callbackServer.listen(0);
    const address = this.callbackServer.address();
    if (address && typeof address !== 'string') {
      this.callbackPort = address.port;
    }
  }

  /**
   * Wait for the OAuth callback to arrive with an authorization code.
   * Returns a promise that resolves with the code.
   */
  private waitForCallback(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!this.callbackServer) {
        reject(new Error('Callback server not running'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('OAuth callback timed out (5 minutes)'));
      }, 5 * 60 * 1000);

      const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
        if (!req.url) {
          res.writeHead(404);
          res.end();
          return;
        }

        const reqUrl = new URL(req.url, `http://localhost:${this.callbackPort}`);

        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(
            '<html><body><h1>Authorization failed</h1><p>You can close this window.</p></body></html>'
          );
          clearTimeout(timeout);
          this.stopCallbackServer();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(
            '<html><body><h1>Authorization successful!</h1><p>You can close this window.</p></body></html>'
          );
          clearTimeout(timeout);
          this.stopCallbackServer();
          resolve(code);
        }
      };

      this.callbackServer.on('request', handler);
    });
  }

  /**
   * Exchange an authorization code for tokens.
   */
  private async exchangeCode(
    code: string,
    codeVerifier: string,
    clientId: string
  ): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: DEFAULT_CLIENT_SECRET,
      redirect_uri: `http://localhost:${this.callbackPort}/callback`,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    return (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
  }

  /**
   * Refresh the access token using the refresh token.
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refresh_token) {
      throw new Error('No refresh token available');
    }

    const body = new URLSearchParams({
      refresh_token: this.tokens.refresh_token,
      client_id: this.getActiveClientId(),
      client_secret: DEFAULT_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.tokens.access_token = data.access_token;
    this.tokens.expires_at = Date.now() + data.expires_in * 1000;

    await this.saveTokens();
  }

  /**
   * Fetch the user's email from the Google userinfo endpoint.
   */
  private async fetchUserEmail(accessToken: string): Promise<string | undefined> {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.ok) {
        const data = (await response.json()) as { email?: string };
        return data.email;
      }
    } catch {
      // Non-critical — we just won't have the email
    }
    return undefined;
  }

  /**
   * Save tokens to disk, encrypted with safeStorage.
   */
  private async saveTokens(): Promise<void> {
    if (!this.tokens) return;

    try {
      const dir = path.dirname(this.tokenPath);
      await fs.mkdir(dir, { recursive: true });

      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(JSON.stringify(this.tokens));
        await fs.writeFile(this.tokenPath, encrypted);
      } else {
        // Fallback: write as plain JSON (not recommended in production)
        await fs.writeFile(this.tokenPath, JSON.stringify(this.tokens), 'utf-8');
      }
    } catch (error) {
      console.error('Failed to save auth tokens:', error);
    }
  }

  /**
   * Load tokens from disk and decrypt with safeStorage.
   */
  private async loadTokens(): Promise<void> {
    try {
      const data = await fs.readFile(this.tokenPath);

      let json: string;
      if (safeStorage.isEncryptionAvailable()) {
        json = safeStorage.decryptString(data);
      } else {
        json = data.toString('utf-8');
      }

      const parsed = JSON.parse(json) as StoredTokens;
      if (parsed.access_token && parsed.refresh_token) {
        this.tokens = parsed;
      }
    } catch {
      // No saved tokens or file corrupt — start fresh
      this.tokens = null;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────

let instance: GoogleAuthService | null = null;

export function getGoogleAuthService(): GoogleAuthService {
  if (!instance) {
    instance = new GoogleAuthService();
  }
  return instance;
}

export function createGoogleAuthService(dataDir?: string): GoogleAuthService {
  return new GoogleAuthService(dataDir);
}

export function resetGoogleAuthService(): void {
  instance = null;
}
