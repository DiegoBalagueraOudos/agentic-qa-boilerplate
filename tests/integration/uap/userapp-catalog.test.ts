/**
 * UAP UserApps: create, edit without password and deactivation (UAP-001, 009, 010).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive
 * Administrator login plus the tenant sign-ins it needs (each in its own request context, one failed
 * sign-in at most, then the address limiter window is waited out). The generated tenant (login limit 3)
 * is prepared in `beforeAll` and deleted in `afterAll`. trace is off because those logins carry live tokens.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('UAP: userapp catalog', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('UAP-001: should create a UserApp with username, password and optional data', async ({ api }) => {
    await api.userApps.createUserAppWithUsernamePasswordAndOptionals(tenantId);
  });

  test('UAP-009: should keep the password when the edit sends none', async ({ api }) => {
    await api.userApps.keepPasswordWhenEditedWithoutPassword(tenantId);
  });

  test('UAP-010: should refuse the sign-in of a deactivated UserApp', async ({ api }) => {
    test.setTimeout(120000);
    await api.userApps.refuseSignInOfDeactivatedUserApp(tenantId);
  });
});
