/**
 * Operator offered by the tenant form: OPE-013.
 *
 * An ACTIVE generated `QAX` operator is created in `beforeAll` and always deleted in
 * `afterAll`. The tenant form is only opened and cancelled. The test keeps the saved
 * Administrator session (nothing is typed). File-level trace off.
 */

import type { GeneratedOperator } from '@data/types';

import { SecurityDataSteps } from '@steps/SecurityDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('Tenant form operator selector', () => {
  const dataSteps = new SecurityDataSteps();
  let operator: GeneratedOperator;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      operator = await dataSteps.createPlainOperator();
    }
    catch (error) {
      await dataSteps.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    await dataSteps.cleanup();
  });

  test('OPE-013: should offer an active operator in the main operator selector', async ({ ui }) => {
    await ui.tenants.listActiveOperatorsInMainSelector(operator);
  });
});
