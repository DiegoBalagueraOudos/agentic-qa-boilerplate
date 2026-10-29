/**
 * Token refresh during a session: AUT-030, AUT-032, AUT-033, AUT-031.
 *
 * Each test signs in with its own login (empty storage state) and removes the
 * session cookies of ITS context by name to simulate an expired token; the shared
 * saved session is never touched. File-level trace off: the context holds live
 * session cookies. Independent tests: all four do positive Administrator logins only.
 * AUT-031 acts on a tenant generated in `beforeAll` and removed in `afterAll`
 * (ADR-0019); it is expected to fail until HAL-57 is fixed.
 */

import type { GeneratedPrincipals } from '@data/types';

import { GeneratedPrincipalsSteps } from '@steps/GeneratedPrincipalsSteps';
import { UiSessionSteps } from '@steps/UiSessionSteps';
import { test } from '@TestFixture';
import { config } from '@variables';

test.use({ trace: 'off' });
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Token refresh', () => {
  const principalsSteps = new GeneratedPrincipalsSteps();
  let principals: GeneratedPrincipals;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    principals = await principalsSteps.create();
  });

  test.afterAll(async () => {
    await principalsSteps.cleanup();
  });

  test('AUT-030: should refresh the session transparently when the token expires on a GET', async ({ ui, page }) => {
    await new UiSessionSteps({ page }).signInAndReachDashboard({
      username: config.testUser.email,
      password: config.testUser.password,
    });
    await ui.session.refreshTransparentlyOnExpiredGet();
  });

  test('AUT-032: should clear the session and go to /login when the refresh fails', async ({ ui, page }) => {
    await new UiSessionSteps({ page }).signInAndReachDashboard({
      username: config.testUser.email,
      password: config.testUser.password,
    });
    await ui.session.clearSessionWhenRefreshFails();
  });

  test('AUT-033: should refresh only once for simultaneous requests with an expired token', async ({ ui, page }) => {
    await new UiSessionSteps({ page }).signInAndReachDashboard({
      username: config.testUser.email,
      password: config.testUser.password,
    });
    await ui.session.refreshOnceForConcurrentRequests();
  });

  test('AUT-031: should ask to repeat the action and not replay a mutation after a refresh', async ({ ui, page }) => {
    await new UiSessionSteps({ page }).signInAndReachDashboard({
      username: config.testUser.email,
      password: config.testUser.password,
    });
    await ui.session.askToRepeatMutationAfterRefresh(principals.tenant);
  });
});
