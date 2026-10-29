/**
 * Page reload with an active session: AUT-036.
 *
 * Own Administrator login (empty storage state): a reload must not depend on the
 * shared saved session. File-level trace off: the context holds live session cookies.
 */

import { UiSessionSteps } from '@steps/UiSessionSteps';
import { test } from '@TestFixture';
import { config } from '@variables';

test.use({ trace: 'off' });
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Session reload', () => {
  test('AUT-036: should keep the session after reloading the page', async ({ ui, page }) => {
    await new UiSessionSteps({ page }).signInAndReachDashboard({
      username: config.testUser.email,
      password: config.testUser.password,
    });
    await ui.shell.reloadWithActiveSession();
  });
});
