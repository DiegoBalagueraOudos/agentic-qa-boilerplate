/**
 * Operators catalog in the UI: OPE-001 (list and search) and OPE-012 (counter after create).
 *
 * A generated `QAX` operator is created in `beforeAll` for OPE-001. OPE-012 creates its own
 * operator through the modal form and always adopts it in a `finally`, so `afterAll` deletes it
 * even when the assertion fails. The catalog is shared: only generated values are touched.
 * The test keeps the saved Administrator session (nothing is typed). File-level trace off.
 */

import type { GeneratedOperator } from '@data/types';

import { DataFactory } from '@DataFactory';
import { SecurityDataSteps } from '@steps/SecurityDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('Operators catalog UI', () => {
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

  test('OPE-001: should list operators and filter them by code and name search', async ({ ui }) => {
    await ui.operators.listAndSearchOperators(operator);
  });

  test('OPE-012: should keep the footer counter in sync after creating an operator', async ({ ui }) => {
    const payload = DataFactory.createPlainOperatorPayload();
    let uiError: Error | null = null;
    try {
      await ui.operators.showCounterInSyncAfterCreate({
        code: payload.OperatorCode!,
        name: payload.OperatorName!,
        serviceUrl: payload.ServiceUrl!,
      });
    }
    catch (error) {
      uiError = error as Error;
    }

    // Only "the UI create never happened" (null) is tolerated; any other failure is never silent
    const adoptError = await dataSteps.adoptOperatorIfCreated(payload.OperatorCode!).then(() => null, (error: Error) => error);
    if (adoptError !== null) {
      const note = `cleanup could not confirm the generated operator ${payload.OperatorCode} (a QAX operator may remain): ${adoptError.message.split('\n')[0]}`;
      test.info().annotations.push({ type: 'cleanup-uncertain', description: note });
      throw new Error([uiError?.message, note].filter(Boolean).join(' | '));
    }
    if (uiError !== null) {
      throw uiError;
    }
  });
});
