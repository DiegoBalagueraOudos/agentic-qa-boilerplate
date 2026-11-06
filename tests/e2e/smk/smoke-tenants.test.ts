/**
 * Smoke on the tenant screens: the list and a detail load clean (SMK-03) and a minimal tenant is created and deleted (SMK-06).
 *
 * SMK-03 works on a GENERATED tenant created through the API; SMK-06 types a tenant in the form with a generated active operator and
 * the tenant the screen creates is found by its RNEC and removed in `afterAll`. The specs keep the saved Administrator session.
 * File-level trace off.
 */

import type { GeneratedOperator } from '@data/types';
import type { UiTenant } from '@steps/UiTenantSteps';

import { DataFactory } from '@DataFactory';
import { SecurityDataSteps } from '@steps/SecurityDataSteps';
import { UiTenantSteps } from '@steps/UiTenantSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('Smoke: tenant screens', () => {
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

  test('SMK-03: should open the tenant list and a tenant detail without errors', { tag: ['@critical'] }, async ({ ui }) => {
    await ui.smoke.openTenantListAndDetail({ tenant: generated });
  });

  test('SMK-06: should create a minimal tenant and delete it', { tag: ['@critical'] }, async ({ ui }) => {
    const payload = DataFactory.createTenantPayload();
    await ui.smoke.createAndDeleteMinimalTenant({
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
      isActive: async rnec => tenants.isActiveByRnec(rnec),
    });
  });
});
