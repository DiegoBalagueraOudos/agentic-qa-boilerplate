/**
 * USR platform users: lockout/unlock and self-protection (USR-009, USR-011).
 *
 * Mail-free. USR-009 sends wrong passwords to a GENERATED Admin only, never to a real account, each in its own request
 * context; the address limiter window (4 failures / 30 s) is waited out between batches and at the end, so the spec sets
 * its own timeout. USR-011 signs in as a generated Admin and tries to deactivate and delete ITSELF; the root account is
 * never the target. trace is off because the logins carry live tokens.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('USR: platform user lockout and self-protection', () => {
  test('USR-009: should show the lockout and unlock the user', async ({ api }) => {
    test.setTimeout(180000);
    await api.users.showAdminLockoutAndUnlock();
  });

  test('USR-011: should refuse that a user deactivates or deletes itself', async ({ api }) => {
    await api.users.refuseSelfDeactivationAndDeletion();
  });
});
