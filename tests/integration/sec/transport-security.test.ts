/**
 * SEC transport security: security headers (SEC-006), Swagger not exposed
 * (SEC-009), CORS refusing foreign origins (SEC-010), CSRF on mutations (SEC-002)
 * and the envelope rules (SEC-001).
 *
 * Empty storage state: SEC-006/009/010 are anonymous; SEC-002 and SEC-001 open
 * their own crypto session and one positive Administrator login each.
 */

import { test } from '@TestFixture';

// trace off (top-level: Playwright forbids it in a describe) for the whole SEC
// transport file, which later holds ATCs that carry session headers.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('Security: transport', () => {
  test('SEC-006: should send the security headers on API and SPA responses', async ({ api }) => {
    await api.transportSecurity.sendSecurityHeaders();
  });

  test('SEC-002: should reject mutations without a valid CSRF token', async ({ api }) => {
    await api.transportSecurity.rejectMutationsWithoutValidCsrf();
  });

  test('SEC-001: should reject plaintext, malformed, tampered, replayed and stale payloads', async ({ api }) => {
    await api.transportSecurity.rejectUnencryptedAndReplayedPayloads();
  });

  test('SEC-009: should not expose Swagger', async ({ api }) => {
    await api.transportSecurity.hideSwaggerOutsideDevelopment();
  });

  test('SEC-010: should refuse cross-origin access from foreign origins', async ({ api }) => {
    await api.transportSecurity.restrictCrossOriginAccess();
  });
});
