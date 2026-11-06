/**
 * Smoke on the three roles: the Administrator reaches the dashboard (SMK-02), the TenantAdmin its panel (SMK-04), the UserApp its
 * query log (SMK-05) and each one signs out (SMK-07).
 *
 * Real accounts: the Administrator (`config.testUser`) and the TenantAdmin (`config.tenantAdminUser`), POSITIVE logins only (a failed
 * attempt counts toward the lockout). The UserApp is generated (ADR-0019): one tenant and one UserApp created in `beforeAll` and
 * removed in `afterAll`. Every case starts signed out and closes the server session it opened. File-level trace off: the browser
 * context holds a live session cookie.
 */

import type { GeneratedPrincipals } from '@data/types';

import { GeneratedPrincipalsSteps } from '@steps/GeneratedPrincipalsSteps';
import { UiSessionSteps } from '@steps/UiSessionSteps';
import { test } from '@TestFixture';
import { config } from '@variables';

test.use({ storageState: { cookies: [], origins: [] } });
test.use({ trace: 'off' });

test.describe('Smoke: the three roles', () => {
  const principalsSteps = new GeneratedPrincipalsSteps();
  let principals: GeneratedPrincipals;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    principals = await principalsSteps.create();
  });

  test.afterAll(async () => {
    await principalsSteps.cleanup();
  });

  const adminCredentials = () => ({ username: config.testUser.email, password: config.testUser.password });
  const tenantAdminCredentials = () => ({ username: config.tenantAdminUser.email, password: config.tenantAdminUser.password });
  const userAppCredentials = () => ({ username: principals.userApp.username, password: principals.userApp.password });

  test('SMK-02: should sign in the Administrator and reach the dashboard', { tag: ['@critical'] }, async ({ ui, page }) => {
    const session = new UiSessionSteps({ page });
    let bodyPassed = false;
    try {
      await ui.smoke.reachDashboardAsAdmin({ signIn: async () => session.signInAndReachDashboard(adminCredentials()) });
      bodyPassed = true;
    }
    finally {
      await session.signOut(bodyPassed);
    }
  });

  test('SMK-04: should sign in the TenantAdmin and reach its panel', { tag: ['@critical'] }, async ({ ui, page }) => {
    const session = new UiSessionSteps({ page });
    let bodyPassed = false;
    try {
      await ui.smoke.reachPanelAsTenantAdmin({ signIn: async () => session.signInAsTenantUserAndReachLanding(tenantAdminCredentials(), /\/admin-panel$/) });
      bodyPassed = true;
    }
    finally {
      await session.signOut(bodyPassed);
    }
  });

  test('SMK-05: should sign in a UserApp and reach its query log', { tag: ['@critical'] }, async ({ ui, page }) => {
    const session = new UiSessionSteps({ page });
    let bodyPassed = false;
    try {
      await ui.smoke.reachQueryLogsAsUserApp({ signIn: async () => session.signInAsTenantUserAndReachLanding(userAppCredentials(), /\/logs\/consultas-nr$/) });
      bodyPassed = true;
    }
    finally {
      await session.signOut(bodyPassed);
    }
  });

  test('SMK-07: should sign out every role and return to the login', { tag: ['@critical'] }, async ({ ui, page }) => {
    const session = new UiSessionSteps({ page });
    try {
      await ui.smoke.signOutEveryRole({
        roles: [
          { label: 'Administrator', signIn: async () => session.signInAndReachDashboard(adminCredentials()) },
          { label: 'TenantAdmin', signIn: async () => session.signInAsTenantUserAndReachLanding(tenantAdminCredentials(), /\/admin-panel$/) },
          { label: 'UserApp', signIn: async () => session.signInAsTenantUserAndReachLanding(userAppCredentials(), /\/logs\/consultas-nr$/) },
        ],
      });
    }
    catch (error) {
      // a failed round may leave a role signed in: close it without masking the failure
      await session.signOut(false);
      throw error;
    }
  });
});
