/**
 * TEN block 2.3 (part 2): delete (TEN-040 to TEN-043).
 *
 * Empty storage state: each ATC opens its own crypto session and spends one positive Administrator login. TEN-041 works on a tenant
 * prepared in `beforeAll` with a branch, a UserApp and a pending TenantAdmin (ONE welcome mail in the sandbox, sent after the sandbox
 * gap and removed in `afterAll`). The other cases create and delete their own tenants. trace is off because the logins carry live tokens.
 */

import { TenantChildrenSteps } from '@steps/TenantChildrenSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('TEN: tenant delete', () => {
  const children = new TenantChildrenSteps();
  let tenantWithChildren = 0;

  test.beforeAll(async () => {
    tenantWithChildren = (await children.prepareTenantWithChildren()).tenantId;
  });

  test.afterAll(async () => {
    await children.cleanup();
  });

  test('TEN-040: should delete a tenant softly', async ({ api }) => {
    await api.tenantManagement.deleteTenantSoftly();
  });

  test('TEN-041: should refuse deleting a tenant that has children', async ({ api }) => {
    await api.tenantManagement.refuseDeletingTenantWithChildren(tenantWithChildren);
  });

  test('TEN-042: should keep the RNEC of a deleted tenant reserved', async ({ api }) => {
    await api.tenantManagement.keepRnecReservedAfterDelete();
  });

  test('TEN-043: should block actions on a deleted tenant', async ({ api }) => {
    await api.tenantManagement.blockActionsOnDeletedTenant();
  });
});
