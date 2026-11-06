/**
 * INT screen cases about errors: a message per status code (INT-003) and the backend down (INT-005).
 *
 * INT-003 sends an operator with an FTP service URL, which the backend refuses with 400, so any operator it could create by mistake is
 * removed in `afterAll`. The cases keep the saved Administrator session. Typed values never reach a step title. File-level trace off.
 */

import { DataFactory } from '@DataFactory';
import { UiTenantSteps } from '@steps/UiTenantSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('INT: errors on screen', () => {
  const tenants = new UiTenantSteps();
  const operatorCode = DataFactory.createOperatorCode();

  test.afterAll(async () => {
    await tenants.removeOperators(operatorCode);
    await tenants.cleanup();
  });

  test('INT-003: should show a clear message for each status code', async ({ ui }) => {
    await ui.contracts.showClearMessageForEachStatusCode({ operator: { operatorCode, operatorName: `QAX${operatorCode} plain`, serviceUrl: 'ftp://qa-sec.invalid/service' } });
  });

  test('INT-005: should show an error and stop the spinner when the backend is down', async ({ ui }) => {
    await ui.contracts.showErrorAndStopSpinnerWhenBackendDown();
  });
});
