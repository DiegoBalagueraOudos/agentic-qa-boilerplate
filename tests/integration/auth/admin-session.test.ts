/**
 * Session reuse check for the API.
 *
 * Maps to no case: it proves `api-setup` left a usable encrypted administrator
 * session (cookies + crypto session) that a separate process can pick up.
 */

import { test } from '@TestFixture';

// Trace off (top-level: Playwright forbids it in a describe): this spec holds the
// live administrator session, so a failing run must not leave its cookies and CSRF
// header in a trace.
test.use({ trace: 'off' });

test.describe('SETUP: API session', { tag: ['@critical'] }, () => {
  test('SETUP: should read with the saved administrator session', async ({ api }) => {
    await api.auth.verifySessionAuthorized();
  });
});
