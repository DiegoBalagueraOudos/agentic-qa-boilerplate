/**
 * Dashboard access by role (DSH-004).
 *
 * Empty storage state. The real TenantAdmin (`config.tenantAdminUser`, positive login only) and a GENERATED UserApp (tenant and user
 * created in `beforeAll` and removed in `afterAll`) sign in one after the other, open `/dashboard` and sign out. File-level trace off:
 * the browser context holds a live session.
 */

import type { GeneratedPrincipals } from '@data/types';

import { GeneratedPrincipalsSteps } from '@steps/GeneratedPrincipalsSteps';
import { UiSessionSteps } from '@steps/UiSessionSteps';
import { test } from '@TestFixture';
import { config } from '@variables';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('Dashboard access by role', () => {
  const principalsSteps = new GeneratedPrincipalsSteps();
  let principals: GeneratedPrincipals;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    principals = await principalsSteps.create();
  });

  test.afterAll(async () => {
    await principalsSteps.cleanup();
  });

  test('DSH-004: should keep tenant users away from the Dashboard', async ({ ui, page }) => {
    const session = new UiSessionSteps({ page });
    await ui.dashboard.redirectTenantUsersAwayFromDashboard({
      signInAs: async (role) => {
        const credentials = role === 'TenantAdmin'
          ? { username: config.tenantAdminUser.email, password: config.tenantAdminUser.password }
          : { username: principals.userApp.username, password: principals.userApp.password };
        await session.signInAsTenantUserAndReachLanding(credentials, role === 'TenantAdmin' ? /\/admin-panel/ : /\/logs\/consultas-nr/);
      },
      signOut: async () => session.signOut(true),
    });
  });
});
