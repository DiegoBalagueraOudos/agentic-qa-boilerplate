/**
 * Login (tenant mode): AUT-003, AUT-004, AUT-008, AUT-012.
 *
 * AUT-003 uses the real TenantAdmin account (`config.tenantAdminUser`, positive login only)
 * in its own describe, with no generated data, and signs it out in a `finally`. The other principals are generated (ADR-0019): one tenant, one UserApp and one platform
 * Admin created once in `beforeAll`, plus two extra UserApps for AUT-008, and
 * removed in `afterAll`. The real account is never sent here. The tests are
 * independent (a failure must not skip the next ones; the runner uses one
 * worker). Two ATCs add failed logins and the address limiter (4 failures in
 * 30 s) is shared; each of them waits out its window in a `finally`.
 * File-level trace off: the browser context holds a live session cookie.
 */

import type { GeneratedPrincipals } from '@data/types';

import { GeneratedPrincipalsSteps } from '@steps/GeneratedPrincipalsSteps';
import { UiSessionSteps } from '@steps/UiSessionSteps';
import { test } from '@TestFixture';
import { config } from '@variables';

test.use({ storageState: { cookies: [], origins: [] } });
test.use({ trace: 'off' });

// Own describe: AUT-003 needs only the real TenantAdmin, so a failing data creation
// below must not turn it red for an unrelated reason.
test.describe('Login (tenant mode): TenantAdmin', () => {
  test.beforeEach(async ({ ui }) => {
    await ui.login.goto();
  });

  test('AUT-003: should sign in a valid TenantAdmin and land on its panel', { tag: ['@critical'] }, async ({ ui, page }) => {
    let bodyPassed = false;
    try {
      // Real account: positive login only (a failed attempt counts toward its lockout)
      await ui.login.loginAsTenantAdminSuccessfully({
        username: config.tenantAdminUser.email,
        password: config.tenantAdminUser.password,
      });
      bodyPassed = true;
    }
    finally {
      // Close the real server session (7-day refresh token) whatever the body did
      await new UiSessionSteps({ page }).signOut(bodyPassed);
    }
  });
});

test.describe('Login (tenant mode): generated principals', () => {
  const principalsSteps = new GeneratedPrincipalsSteps();
  let principals: GeneratedPrincipals;
  let inactiveUserApp: GeneratedPrincipals['userApp'];
  let deletedUserApp: GeneratedPrincipals['userApp'];

  test.beforeAll(async () => {
    test.setTimeout(120000);
    principals = await principalsSteps.create();
    inactiveUserApp = await principalsSteps.createExtraUserApp();
    deletedUserApp = await principalsSteps.createExtraUserApp();
    await principalsSteps.deactivateUserApp(inactiveUserApp.id);
    await principalsSteps.deleteUserApp(deletedUserApp.id);
  });

  test.afterAll(async () => {
    await principalsSteps.cleanup();
  });

  test.beforeEach(async ({ ui }) => {
    await ui.login.goto();
  });

  test('AUT-004: should sign in a valid UserApp and land on its log screen', { tag: ['@critical'] }, async ({ ui }) => {
    await ui.login.loginAsUserAppSuccessfully({
      username: principals.userApp.username,
      password: principals.userApp.password,
    });
  });

  test('AUT-008: should deny an inactive and a deleted UserApp with a message', async ({ ui }) => {
    test.setTimeout(90000);
    await ui.login.loginWithInactiveOrDeletedUser({
      inactive: { username: inactiveUserApp.username, password: inactiveUserApp.password },
      deleted: { username: deletedUserApp.username, password: deletedUserApp.password },
    });
  });

  test('AUT-012: should reject a UserApp in the admin form and an Admin in the tenant form', async ({ ui }) => {
    test.setTimeout(90000);
    await ui.login.loginInTheWrongMode({
      userApp: { username: principals.userApp.username, password: principals.userApp.password },
      admin: { username: principals.admin.username, password: principals.admin.password },
    });
  });
});
