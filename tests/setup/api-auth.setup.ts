/**
 * KATA Architecture - API Auth Setup (Project)
 *
 * Mints an encrypted administrator session the way a real client does
 * (ADR-0018): ECDH handshake, then the admin login inside an AES-GCM envelope.
 * No plaintext fallback, no CSRF bypass.
 *
 * Persists, under the ignored `.auth/` directory only:
 * - api-session.json:    the three session cookies (Playwright storage state)
 * - crypto-session.json: session id + AES key. SECRET: never log or commit it.
 *
 * Per-run mint, no refresh: the server drops a crypto session after 30 idle
 * minutes (8 h at most). Re-run setup when a suite starts failing with
 * CRYPTO_SESSION_EXPIRED.
 *
 * Dependencies: global-setup
 * Dependents: integration, smoke-api
 */

import { writeFileSync } from 'node:fs';
import { test as setup } from '@TestFixture';
import { config } from '@variables';

// File-level trace off: the trace would record the real credential sent in the login request.
setup.use({ trace: 'off' });

setup('API Setup: authenticate via API', async ({ api }) => {
  console.log('[API Setup] Starting API authentication...');
  console.log(`[API Setup] Target: ${config.apiUrl}${config.auth.adminLoginEndpoint}`);

  const [, , session] = await api.auth.startAdminSession({
    UserName: config.testUser.email,
    Password: config.testUser.password,
  });
  console.log('[API Setup] Administrator session established');

  // Prove the session works before anything depends on it
  await api.auth.verifySessionAuthorized();
  console.log('[API Setup] Authorized read succeeded');

  await api.request.storageState({ path: config.auth.apiSessionPath });
  writeFileSync(config.auth.cryptoSessionPath, JSON.stringify(session, null, 2), { mode: 0o600 });
  console.log(`[API Setup] Session saved to ${config.auth.apiSessionPath} and ${config.auth.cryptoSessionPath}`);
});
