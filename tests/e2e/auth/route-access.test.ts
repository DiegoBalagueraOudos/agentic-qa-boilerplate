/**
 * Role access: AUT-040, AUT-041, AUT-042.
 *
 * Three roles: Administrator (`config.testUser`) and TenantAdmin
 * (`config.tenantAdminUser`) are the real accounts and only do POSITIVE logins; the
 * UserApp is generated in `beforeAll` (ADR-0019) and removed in `afterAll`. Each
 * test signs every role in by itself (empty storage state) and signs it out
 * again, so the shared saved session is never touched. The tests are independent.
 * File-level trace off: the browser context holds live session cookies.
 */

import type { GeneratedPrincipals } from '@data/types';
import type { Page } from '@playwright/test';
import type { RoleSignIns } from '@ui/ShellPage';

import { GeneratedPrincipalsSteps } from '@steps/GeneratedPrincipalsSteps';
import { UiSessionSteps } from '@steps/UiSessionSteps';
import { test } from '@TestFixture';
import { config } from '@variables';

test.use({ trace: 'off' });
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Role access', () => {
  const principalsSteps = new GeneratedPrincipalsSteps();
  let principals: GeneratedPrincipals;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    principals = await principalsSteps.create();
  });

  test.afterAll(async () => {
    await principalsSteps.cleanup();
  });

  /** One positive login per role, through the real forms. */
  const buildSignIns = (page: Page): RoleSignIns => {
    const steps = new UiSessionSteps({ page });
    return {
      Administrator: async () => steps.signInAndReachDashboard({
        username: config.testUser.email,
        password: config.testUser.password,
      }),
      TenantAdmin: async () => steps.signInAsTenantUserAndReachLanding({
        username: config.tenantAdminUser.email,
        password: config.tenantAdminUser.password,
      }, /\/admin-panel$/),
      UserApp: async () => steps.signInAsTenantUserAndReachLanding({
        username: principals.userApp.username,
        password: principals.userApp.password,
      }, /\/logs\/consultas-nr$/),
    };
  };

  test('AUT-040: should follow the role x route matrix by direct URL', async ({ ui, page }) => {
    test.setTimeout(180000);
    await ui.shell.followRouteMatrixByDirectUrl(buildSignIns(page));
  });

  test('AUT-041: should show only the sidebar entries of the role', async ({ ui, page }) => {
    test.setTimeout(120000);
    await ui.shell.showOnlyMenuOfTheRole(buildSignIns(page));
  });

  test('AUT-042: should redirect the root route to the home of each role', async ({ ui, page }) => {
    test.setTimeout(120000);
    await ui.shell.redirectRootByRole(buildSignIns(page));
  });
});
