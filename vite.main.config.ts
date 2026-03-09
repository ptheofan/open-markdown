import { defineConfig, loadEnv } from 'vite';
import crypto from 'node:crypto';
import path from 'node:path';

/**
 * Obfuscate a string at build time using AES-256-CBC.
 * This is NOT security — the key is in the source. It simply prevents
 * the raw value from appearing as a greppable string in the bundle.
 */
function obfuscate(value: string): string {
  if (!value) return '';
  const key = crypto.scryptSync('open-markdown-obf', 'docs-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    define: {
      '__GOOGLE_OAUTH_CLIENT_ID_ENC__': JSON.stringify(obfuscate(env.GOOGLE_OAUTH_CLIENT_ID ?? '')),
    },
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared'),
        '@main': path.resolve(__dirname, 'src/main'),
        '@plugins': path.resolve(__dirname, 'src/plugins'),
      },
    },
  };
});
