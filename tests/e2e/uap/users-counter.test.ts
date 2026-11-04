/**
 * Tenant detail screen: the users counter after creating a user (UAP-014).
 *
 * A GENERATED tenant with one UserApp is prepared in `beforeAll` (no mail); the users and the tenant are deleted in `afterAll`. The user
 * the form creates is deleted with the rest. It keeps the saved Administrator session. File-level trace off.
 */

import { DataFactory } from '@DataFactory';
import { UiTenantSteps } from '@steps/UiTenantSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('Tenant users counter', () => {
  const tenants = new UiTenantSteps();
  let tenantId = 0;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      tenantId = (await tenants.prepareTenant()).id;
      await tenants.prepareUserApp(tenantId);
    }
    catch (error) {
      await tenants.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    await tenants.cleanup();
  });

  test('UAP-014: should keep the users counter and the rows after creating a user', async ({ ui }) => {
    const user = DataFactory.createUserAppPayload();
    await ui.tenantDetail.keepUsersCounterAfterCreating({
      tenantId,
      user: { fullName: String(user.FullName), username: String(user.UserName), password: String(user.Password) },
    });
  });
});
