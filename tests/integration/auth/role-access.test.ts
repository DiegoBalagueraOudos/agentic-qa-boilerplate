/**
 * AUT-043: a signed-in principal of the wrong role is refused with 403 on the
 * Administrator-only routes (Tenant, Operators, Contingency, User).
 *
 * Two principals inside the one ATC: a UserApp generated in `beforeAll` (ADR-0019)
 * and the real TenantAdmin (`config.tenantAdminUser`, positive login only). Each
 * runs on its OWN session (empty storage state, crypto session opened inside the
 * ATC) and signs out; no failed login is sent.
 */

import type { GeneratedPrincipals } from '@data/types';

import { GeneratedPrincipalsSteps } from '@steps/GeneratedPrincipalsSteps';
import { test } from '@TestFixture';
import { config } from '@variables';

// trace off (top-level: Playwright forbids it in a describe): the tenant login
// issues live session cookies that must not end up in a trace.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('Auth session: role access', () => {
  const principals = new GeneratedPrincipalsSteps();
  let generated: GeneratedPrincipals;

  test.beforeAll(async () => {
    // Tenant, UserApp and Admin creation through the API exceeds the 60 s global timeout
    test.setTimeout(120000);
    generated = await principals.create();
  });

  test.afterAll(async () => {
    await principals.cleanup();
  });

  test('AUT-043: should refuse a signed-in UserApp and TenantAdmin with 403 on the Administrator-only routes', async ({ api }) => {
    await api.access.rejectOutOfRoleCalls(
      { username: generated.userApp.username, password: generated.userApp.password },
      { username: config.tenantAdminUser.email, password: config.tenantAdminUser.password },
    );
  });
});
