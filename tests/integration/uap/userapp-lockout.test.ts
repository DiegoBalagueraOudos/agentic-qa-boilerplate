/**
 * UAP-011: the lockout is visible to the Administrator and the unlock works.
 *
 * Mail-free. The generated tenant has a failed-login limit of 3. Three wrong passwords go to a GENERATED UserApp,
 * never to a real account, each in its own request context; the address limiter window (4 failures / 30 s) is
 * waited out after the last one, so the spec sets its own timeout. trace is off because the logins carry live tokens.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('UAP: userapp lockout', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('UAP-011: should show the lockout and unlock the UserApp', async ({ api }) => {
    test.setTimeout(120000);
    await api.userApps.showLockoutAndUnlock(tenantId);
  });
});
