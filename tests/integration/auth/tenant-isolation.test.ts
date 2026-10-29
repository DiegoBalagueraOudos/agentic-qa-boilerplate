/**
 * AUT-044: a TenantAdmin of one tenant cannot read the data of another tenant (IDOR).
 *
 * The real TenantAdmin (`config.tenantAdminUser`, positive login only) signs in on
 * its OWN session (empty storage state, crypto session opened inside the ATC). The
 * "other tenant" is a tenant GENERATED in `beforeAll` (ADR-0019) and removed in
 * `afterAll`. No failed login is sent.
 */

import type { GeneratedPrincipals } from '@data/types';

import { GeneratedPrincipalsSteps } from '@steps/GeneratedPrincipalsSteps';
import { test } from '@TestFixture';
import { config } from '@variables';

// trace off (top-level: Playwright forbids it in a describe): the tenant login
// issues live session cookies that must not end up in a trace.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('Auth session: tenant isolation', () => {
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

  test('AUT-044: should refuse a TenantAdmin reading the users of another tenant with 403', async ({ api }) => {
    await api.access.rejectCrossTenantRead(
      { username: config.tenantAdminUser.email, password: config.tenantAdminUser.password },
      generated.tenant.id,
    );
  });
});
