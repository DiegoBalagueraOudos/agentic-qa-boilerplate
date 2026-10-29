/**
 * Login redirect for a signed-in user: AUT-013.
 *
 * Uses the saved Administrator session (the e2e default) and only reads it:
 * opening /login changes nothing. File-level trace off: the context holds a
 * live session cookie.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('Login redirect (signed in)', () => {
  test('AUT-013: should send a signed-in user from /login to the dashboard', async ({ ui }) => {
    await ui.login.openLoginWhileSignedIn();
  });
});
