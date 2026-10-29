/**
 * Logout in one tab of the same browser: AUT-037.
 *
 * Two tabs share one context (one cookie jar). Tab A signs in, tab B signs in too,
 * B logs out, and tab A must lose its session cleanly on its next protected request.
 * Empty storage state and file-level trace off: the context holds live session
 * cookies. Only positive Administrator logins (two per run). B's logout closes B's
 * server session; A's own refresh token is left orphaned (accepted as inherent, Q4).
 * A best-effort sign-out in `finally` covers a body that failed before B logged out.
 */

import { UiSessionSteps } from '@steps/UiSessionSteps';
import { test } from '@TestFixture';
import { config } from '@variables';

test.use({ trace: 'off' });
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Multi-tab logout', () => {
  test('AUT-037: should end the other tab\'s session cleanly when one tab logs out', async ({ ui, page, context }) => {
    const credentials = {
      username: config.testUser.email,
      password: config.testUser.password,
    };
    const stepsA = new UiSessionSteps({ page });
    const pageB = await context.newPage();
    const stepsB = new UiSessionSteps({ page: pageB });
    let loggedOut = false;

    try {
      await stepsA.signInAndReachDashboard(credentials);

      await stepsB.signInAndReachDashboard(credentials);

      await ui.session.loseSessionWhenOtherTabLogsOut(async () => {
        await stepsB.signOut();
        loggedOut = true;
      });
    }
    finally {
      if (!loggedOut) {
        // The server session must not stay open: sign out from whichever tab shows the shell
        let signedInTab = stepsA;
        try {
          if (await pageB.getByRole('button', { name: 'Cerrar sesión' }).isVisible()) {
            signedInTab = stepsB;
          }
        }
        catch {
          // closed page or crashed target: treat as not visible and fall back to tab A
        }
        try {
          await signedInTab.signOut(false);
        }
        catch {
          test.info().annotations.push({ type: 'signout-failed', description: 'best-effort sign-out failed' });
        }
      }
      await pageB.close().catch(() => undefined);
    }
  });
});
