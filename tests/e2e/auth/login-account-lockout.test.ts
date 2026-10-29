/**
 * Login account lockout (admin mode): AUT-009.
 *
 * A generated NON-root platform Admin (ADR-0019) is locked with wrong passwords;
 * the real account is never sent a wrong password. The global threshold is read
 * through the security config API first (own Administrator session, in the Steps
 * layer): the case needs it to be at most 3, otherwise the address limiter
 * (4 failures in 30 s) trips before the account locks. The ATC waits out the
 * limiter window in a `finally`. Own file, single worker advised: the
 * limiter is shared by every client behind the proxy.
 * File-level trace off: the browser context holds a live session cookie.
 */

import { GeneratedPrincipalsSteps } from '@steps/GeneratedPrincipalsSteps';
import { test } from '@TestFixture';

test.use({ storageState: { cookies: [], origins: [] } });
test.use({ trace: 'off' });

test.describe('Login account lockout (admin mode)', () => {
  const principalsSteps = new GeneratedPrincipalsSteps();
  let admin: { username: string, password: string };
  let maxAttempts: number;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    const principals = await principalsSteps.create();
    admin = { username: principals.admin.username, password: principals.admin.password };
    maxAttempts = await principalsSteps.readAdminLockoutThreshold();
  });

  test.afterAll(async () => {
    await principalsSteps.cleanup();
  });

  test('AUT-009: should lock a generated Admin after failed logins and reject even the correct password', async ({ ui }) => {
    // Body: control login + up to 3 wrong + 1 locked attempt; release in finally up to 35 s.
    test.setTimeout(120000);
    await ui.login.goto();
    await ui.login.lockGeneratedAdminAfterFailedLogins(admin, maxAttempts);
  });
});
