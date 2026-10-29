/**
 * AUT-039: a refresh token captured before logout is rejected after logout.
 *
 * Runs on its OWN session: an empty storage state (not the shared administrator
 * cookies) and a crypto session opened inside the ATC, so the logout cannot
 * revoke the session the other integration specs depend on.
 */

import { test } from '@TestFixture';
import { config } from '@variables';

// trace off (top-level: Playwright forbids it in a describe): a failing run must not
// leave a still-valid refresh token in the trace.
test.use({ trace: 'off' });

test.describe('Auth session: refresh token', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('AUT-039: should reject a refresh token reused after logout', async ({ api }) => {
    await api.auth.reuseRefreshTokenAfterLogout({
      UserName: config.testUser.email,
      Password: config.testUser.password,
    });
  });
});
