/**
 * SEC session security: session cookie flags (SEC-005) and no secrets on the API
 * channel (SEC-007).
 *
 * Empty storage state: each ATC opens its own crypto session and spends one positive
 * Administrator login (SEC-005 adds one positive login of a generated UserApp). The
 * generated tenant, UserApp and platform Admin (ADR-0019) are prepared here and removed
 * in `afterAll`. trace is off because the logins carry live tokens.
 */

import type { GeneratedPrincipals } from '@data/types';

import { GeneratedPrincipalsSteps } from '@steps/GeneratedPrincipalsSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe.configure({ mode: 'serial' });

test.describe('Security: session', () => {
  const principalsSteps = new GeneratedPrincipalsSteps();
  let generated: GeneratedPrincipals;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    generated = await principalsSteps.create();
  });

  test.afterAll(async () => {
    await principalsSteps.cleanup();
  });

  test('SEC-005: should configure the session cookies with HttpOnly, Secure and SameSite', async ({ api }) => {
    await api.sessionSecurity.setSessionCookieFlags({
      userApp: { username: generated.userApp.username, password: generated.userApp.password },
    });
  });

  test('SEC-007: should keep tokens, passwords and secrets out of API responses', async ({ api }) => {
    await api.sessionSecurity.keepSecretsOutOfResponses({
      tenantId: generated.tenant.id,
      userApp: { id: generated.userApp.id, password: generated.userApp.password },
      admin: { id: generated.admin.id, username: generated.admin.username, password: generated.admin.password },
    });
  });
});
