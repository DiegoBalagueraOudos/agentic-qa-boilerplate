/**
 * Administradores tab load time: ADM-013.
 *
 * A generated, empty tenant is created in `beforeAll` and always deleted in `afterAll`
 * (no administrator is created, so no e-mail is sent). The test keeps the saved
 * Administrator session (nothing is typed). File-level trace off.
 */

import type { GeneratedTenant } from '@steps/TenantAdminAccountSteps';

import { TenantAdminAccountSteps } from '@steps/TenantAdminAccountSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('Administradores tab load time', () => {
  const steps = new TenantAdminAccountSteps();
  let tenant: GeneratedTenant;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      tenant = await steps.prepareTenant();
    }
    catch (error) {
      await steps.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    await steps.cleanup();
  });

  test('ADM-013: should load the Administradores tab in under 3 seconds', async ({ ui }) => {
    await ui.tenantAdmins.loadAdministratorsTabWithinThreshold({ tenantId: tenant.id });
  });
});
