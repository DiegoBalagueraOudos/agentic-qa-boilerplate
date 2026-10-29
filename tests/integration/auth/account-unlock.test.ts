/**
 * AUT-011: a UserApp locked by failed logins can sign in again once the
 * Administrator unlocks it.
 *
 * Runs on its OWN session (empty storage state, crypto session opened inside the
 * ATC). The locked account is GENERATED (ADR-0019) in a tenant with a failed-login
 * limit of 3: wrong passwords never reach the real account. The ATC waits out the
 * shared address limiter before it ends.
 */

import type { GeneratedPrincipals } from '@data/types';

import { GeneratedPrincipalsSteps } from '@steps/GeneratedPrincipalsSteps';
import { test } from '@TestFixture';

// trace off (top-level: Playwright forbids it in a describe): the tenant login
// issues live session cookies that must not end up in a trace.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe.configure({ mode: 'serial' });

test.describe('Auth session: account unlock', () => {
  const principals = new GeneratedPrincipalsSteps();
  let generated: GeneratedPrincipals;

  test.beforeAll(async () => {
    generated = await principals.create();
  });

  test.afterAll(async () => {
    await principals.cleanup();
  });

  test('AUT-011: should allow a locked UserApp to sign in again after the Administrator unlocks it', async ({ api }) => {
    // Flow plus the ~31 s limiter wait in `finally` exceed the 60 s global timeout
    test.setTimeout(120000);
    await api.userApps.unlockLockedUserApp({
      tenantId: generated.tenant.id,
      userAppId: generated.userApp.id,
      username: generated.userApp.username,
      password: generated.userApp.password,
    });
  });
});
