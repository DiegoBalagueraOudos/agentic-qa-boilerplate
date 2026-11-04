/**
 * Tenant screen cases: required fields (TEN-021), the MAC-serial warning (TEN-013), rapid clicks on Crear (TEN-026) and cancelling the disable confirmation (TEN-037).
 *
 * TEN-026 types a valid tenant in the form and picks a generated active operator (created in `beforeAll`); the tenant the screen creates
 * is found by its RNEC and deleted in `afterAll`. TEN-037 works on a generated tenant created through the API. The specs keep the saved
 * Administrator session. File-level trace off.
 */

import type { GeneratedOperator } from '@data/types';
import type { UiTenant } from '@steps/UiTenantSteps';

import { DataFactory } from '@DataFactory';
import { SecurityDataSteps } from '@steps/SecurityDataSteps';
import { UiTenantSteps } from '@steps/UiTenantSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('Tenant screen forms and confirmations', () => {
  const operators = new SecurityDataSteps();
  const tenants = new UiTenantSteps();
  let operator: GeneratedOperator;
  let generated: UiTenant;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      operator = await operators.createPlainOperator();
      generated = await tenants.prepareTenant();
    }
    catch (error) {
      await operators.cleanup().catch(() => undefined);
      await tenants.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    const failures: string[] = [];
    for (const cleanup of [async () => tenants.cleanup(), async () => operators.cleanup()]) {
      try {
        await cleanup();
      }
      catch (error) {
        failures.push(String((error as Error).message).split('\n')[0]);
      }
    }
    if (failures.length > 0) {
      throw new Error(`cleanup incomplete: ${failures.join('; ')}`);
    }
  });

  test('TEN-021: should require the fields and the main operator', async ({ ui }) => {
    await ui.tenants.requireFieldsInEmptyTenantForm();
  });

  test('TEN-026: should create a single tenant on rapid clicks', async ({ ui }) => {
    const payload = DataFactory.createTenantPayload();
    await ui.tenants.createOneTenantOnRapidClicks({
      tenant: {
        rnec: String(payload.Rnec),
        businessName: String(payload.BusinessName),
        dbHost: String(payload.DbHost),
        dbName: String(payload.DbName),
        dbUser: String(payload.DbUser),
        dbPassword: String(payload.DbPassword),
      },
      operator,
      countByRnec: async rnec => tenants.countByRnec(rnec),
    });
  });

  test('TEN-013: should warn without announcing success when the MAC-serial configuration fails', async ({ ui }) => {
    const payload = DataFactory.createTenantPayload();
    await ui.tenants.warnWithoutSuccessWhenMacConfigFails({
      tenant: {
        rnec: String(payload.Rnec),
        businessName: String(payload.BusinessName),
        dbHost: String(payload.DbHost),
        dbName: String(payload.DbName),
        dbUser: String(payload.DbUser),
        dbPassword: String(payload.DbPassword),
      },
      operator,
      countByRnec: async rnec => tenants.countByRnec(rnec),
    });
  });

  test('TEN-037: should keep the tenant when the disable confirmation is cancelled', async ({ ui }) => {
    await ui.tenants.keepTenantActiveWhenCancellingDisable({ tenant: generated, isActive: async () => tenants.isActive(generated.id) });
  });
});
