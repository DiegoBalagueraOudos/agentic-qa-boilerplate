/**
 * Manual logout: AUT-014, AUT-015.
 *
 * Each test signs in with its own login (empty storage state): logging out would
 * otherwise revoke the shared saved session every other e2e spec uses. File-level
 * trace off: the context holds live session cookies. Independent tests: they only
 * do positive logins, so a failure in one must not skip the other.
 */

import { UiSessionSteps } from '@steps/UiSessionSteps';
import { test } from '@TestFixture';
import { config } from '@variables';

test.use({ trace: 'off' });
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Manual logout', () => {
  test('AUT-014: should clear the session and go to /login on manual logout', async ({ ui, page }) => {
    await new UiSessionSteps({ page }).signInAndReachDashboard({
      username: config.testUser.email,
      password: config.testUser.password,
    });
    await ui.shell.logoutManually();
  });

  test('AUT-015: should clear the local session on logout with the backend down', async ({ ui, page }) => {
    await new UiSessionSteps({ page }).signInAndReachDashboard({
      username: config.testUser.email,
      password: config.testUser.password,
    });
    await ui.shell.logoutWithBackendDown();
  });
});
