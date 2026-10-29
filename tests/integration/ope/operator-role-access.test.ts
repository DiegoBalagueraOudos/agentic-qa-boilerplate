/**
 * OPE-011: a signed-in principal that is not the platform Administrator is refused on every
 * operator route (GET list, GET by id, POST, PUT, DELETE) with 403 and the permission message.
 *
 * Two principals inside the one ATC: a UserApp generated in `beforeAll` (ADR-0019, handed over
 * as a thunk) and the real TenantAdmin (`config.tenantAdminUser`, positive login only, read
 * inside the component). Each runs on its OWN session (empty storage state) and signs out; no
 * failed login is sent. The target operator is generated and read back by the Steps as the
 * Administrator, so "unchanged" is judged from the server. Mail-free.
 */

import type { GeneratedOperator, GeneratedPrincipals } from '@data/types';

import { GeneratedPrincipalsSteps } from '@steps/GeneratedPrincipalsSteps';
import { SecurityDataSteps } from '@steps/SecurityDataSteps';
import { test } from '@TestFixture';

// trace off (top-level: Playwright forbids it in a describe): the tenant login
// issues live session cookies that must not end up in a trace.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('OPE: operator role access', () => {
  const principals = new GeneratedPrincipalsSteps();
  const security = new SecurityDataSteps();
  let generated: GeneratedPrincipals;
  let target: GeneratedOperator;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      generated = await principals.create();
      target = await security.createPlainOperator();
    }
    catch (error) {
      await security.cleanup().catch(() => undefined);
      await principals.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    const results = await Promise.allSettled([security.cleanup(), principals.cleanup()]);
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length > 0) {
      throw new Error(failed.map(result => String((result).reason?.message ?? result.reason).split('\n')[0]).join('; '));
    }
  });

  test('OPE-011: should refuse a UserApp and a TenantAdmin on the operator routes', async ({ api }) => {
    test.setTimeout(120000);
    await api.operators.refuseOperatorsToNonAdminRoles({
      userApp: () => ({ UserName: generated.userApp.username, Password: generated.userApp.password }),
      target: { id: target.id },
      readTarget: security.readOperator(target.id),
      trackCreated: operatorId => security.trackOperator(operatorId),
    });
  });
});
