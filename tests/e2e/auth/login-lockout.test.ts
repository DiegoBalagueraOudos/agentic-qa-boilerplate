/**
 * Login lockout (admin mode): AUT-010.
 *
 * The backend limiter is per remote address (4 failures in 30 s block 30 s) and
 * hits every client behind the proxy. Own file; the ATC waits for the release in
 * a `finally` (notice gone, button enabled and ~31 s since the first 429 seen),
 * so it tries to leave the address clean even when the body fails. If that wait
 * itself fails the address may stay locked; the report then carries a
 * `release-failed` annotation.
 */

import { DataFactory } from '@DataFactory';
import { test } from '@TestFixture';

// File-level trace off: the trace records the arguments of fill/evaluate, which carry a real credential.
test.use({ trace: 'off' });

test.describe('Login lockout (admin mode)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('AUT-010: should show the waiting notice and countdown after repeated failed logins', async ({ ui }) => {
    // Worst case 180 s: body 60 s (up to 5 attempts plus the 10 s countdown poll)
    // + release in finally 120 s (UI waits 40 s + 40 s, then the ~31 s-since-429
    // poll capped at 35 s, which runs after them).
    test.setTimeout(180000);
    await ui.login.goto();
    // Generated user that does not exist: never the real administrator.
    const { email, password } = DataFactory.createCredentials();
    await ui.login.showRateLimitNoticeAfterFailedLogins({ username: email, password });
  });
});
