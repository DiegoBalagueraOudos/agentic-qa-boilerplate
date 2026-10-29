/**
 * SEC-008: brute force on the login is answered with a lock and a rate limit.
 *
 * Own file and a single worker: the case trips the address limiter (4 failed logins
 * per 30 s, shared by every client behind the proxy) and waits it out before it ends.
 * Both accounts are GENERATED (ADR-0019); the real Administrator and TenantAdmin never
 * receive a wrong password. The global Admin lock threshold is read first. trace is off
 * because the logins carry live session cookies.
 */

import type { GeneratedPrincipals } from '@data/types';

import { GeneratedPrincipalsSteps } from '@steps/GeneratedPrincipalsSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe.configure({ mode: 'serial' });

test.describe('Security: brute force', () => {
  const principalsSteps = new GeneratedPrincipalsSteps();
  let generated: GeneratedPrincipals;
  let adminThreshold: number;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    generated = await principalsSteps.create();
    adminThreshold = await principalsSteps.readAdminLockoutThreshold();
  });

  test.afterAll(async () => {
    await principalsSteps.cleanup();
  });

  test('SEC-008: should lock accounts and rate-limit repeated failed logins', async ({ api }) => {
    // Two rows (~10 s of requests each) plus two limiter waits of ~31 s
    test.setTimeout(180000);
    await api.sessionSecurity.lockAndThrottleBruteForceLogins({
      userApp: { username: generated.userApp.username, password: generated.userApp.password },
      admin: { username: generated.admin.username, password: generated.admin.password },
      adminThreshold,
    });
  });
});
