/**
 * CFG-008: a new global lockout threshold applies to the failed logins of a platform Admin.
 *
 * Mail-free. The ATC changes the GLOBAL threshold, locks a GENERATED Admin with wrong passwords (never a real account), puts the
 * original threshold back and waits out the address limiter (4 failures / 30 s) before it ends. Empty storage state, trace off.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('CFG: lockout threshold applied', () => {
  test('CFG-008: should apply the new threshold to the failed logins of an Admin', async ({ api }) => {
    test.setTimeout(120000);
    await api.users.applyNewLockoutThresholdToAdminLogins();
  });
});
