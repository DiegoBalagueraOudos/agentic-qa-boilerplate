/**
 * Inactivity logout: AUT-034, AUT-035.
 *
 * Cases live in .context/QA/cases/AUT/. Scope: the SPA's client-side 15 min
 * inactivity timer under Playwright's clock control. The test signs in with its
 * own login (empty storage state): the logout would otherwise revoke the shared
 * saved session every other e2e spec uses.
 */

import { UiSessionSteps } from '@steps/UiSessionSteps';
import { test } from '@TestFixture';
import { config } from '@variables';

// The context holds live session cookies of the real account: no trace
test.use({ trace: 'off' });
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Session inactivity', () => {
  test('AUT-034: should sign the user out after 15 minutes without activity', async ({ ui }) => {
    await ui.login.logoutAfterInactivity({
      username: config.testUser.email,
      password: config.testUser.password,
    });
  });

  test('AUT-035: should keep the session after user activity restarts the counter', async ({ ui, page }) => {
    await new UiSessionSteps({ page }).signInAndReachDashboard({
      username: config.testUser.email,
      password: config.testUser.password,
    }, { fakeClock: true });
    await ui.session.keepSessionAfterActivity();
  });
});
