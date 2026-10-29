/**
 * AUT-045: a request without a session and a request with a Bearer JWT carrying
 * an invalid signature are both rejected with 401.
 *
 * Runs on its OWN session: an empty storage state (not the shared administrator
 * cookies) and a crypto session opened inside the ATC. The forged token is built
 * locally; no real token is read.
 */

import { test } from '@TestFixture';

// trace off (top-level: Playwright forbids it in a describe): the request carries
// a JWT-shaped Authorization header that must not end up in a trace.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('Auth session: token integrity', () => {
  test('AUT-045: should reject a request with no session and a JWT with an invalid signature', async ({ api }) => {
    await api.access.rejectTamperedToken();
  });
});
