/**
 * OPE-009 and OPE-008: an operator used as MAIN operator by a tenant is protected.
 *
 * OPE-009: DELETE must be blocked by the backend (400/409) or answered 200 with a `Warning`.
 * OPE-008: deactivating (`IsActive` false) must be refused (400/409) and the operator stays active.
 * Both are EXPECTED TO FAIL on the current product (no usage check). Each ATC has its OWN
 * generated operator and tenant, so a wrongly deleted or deactivated operator in one cannot
 * break the other. No TenantAdmin is created: mail-free. The tenant is removed before its operator.
 */

import type { GeneratedOperator } from '@data/types';

import { SecurityDataSteps } from '@steps/SecurityDataSteps';
import { test } from '@TestFixture';

// trace off (top-level: Playwright forbids it in a describe): the Administrator session
// issues live cookies that must not end up in a trace.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('OPE: operator in use', () => {
  const forDelete = new SecurityDataSteps();
  const forDeactivate = new SecurityDataSteps();
  let deleteOperator: GeneratedOperator;
  let deactivateOperator: GeneratedOperator;
  let deleteTenantId: number;
  let deactivateTenantId: number;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      deleteOperator = await forDelete.createPlainOperator();
      deleteTenantId = (await forDelete.createTenantUsingOperator(deleteOperator.id)).id;
      deactivateOperator = await forDeactivate.createPlainOperator();
      deactivateTenantId = (await forDeactivate.createTenantUsingOperator(deactivateOperator.id)).id;
    }
    catch (error) {
      await Promise.allSettled([forDelete.cleanup(), forDeactivate.cleanup()]);
      throw error;
    }
  });

  test.afterAll(async () => {
    test.setTimeout(120000);
    const results = await Promise.allSettled([forDelete.cleanup(), forDeactivate.cleanup()]);
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length > 0) {
      throw new Error(failed.map(result => String(result.reason?.message ?? result.reason).split('\n')[0]).join('; '));
    }
  });

  test('OPE-009: should refuse or warn when deleting an operator in use', async ({ api }) => {
    await api.operators.refuseDeletingOperatorInUse({
      operator: { id: deleteOperator.id, code: deleteOperator.code },
      readTenantMainOperatorId: forDelete.readTenantMainOperatorId(deleteTenantId),
    });
  });

  test('OPE-008: should refuse deactivating an operator with assigned tenants', async ({ api }) => {
    await api.operators.refuseDeactivatingOperatorInUse({
      operator: { id: deactivateOperator.id, code: deactivateOperator.code },
      readTenantMainOperatorId: forDeactivate.readTenantMainOperatorId(deactivateTenantId),
    });
  });
});
