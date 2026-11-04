/**
 * TEN block 2.6 (part 2): the TenantAdmin edits its own tenant (TEN-091, TEN-092).
 *
 * Both cases work on a GENERATED tenant and TenantAdmin prepared in `beforeAll` (ONE welcome mail in the sandbox, sent after the sandbox
 * gap and removed in `afterAll`), never on the suite's real account. Empty storage state; trace is off because the logins carry live tokens.
 * The API-credential route is rate limited (10 per minute): the component waits for a free slot.
 */

import type { ActivatedTenantAdmin } from '@steps/TenantAdminPanelSteps';

import { TenantAdminPanelSteps } from '@steps/TenantAdminPanelSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe.configure({ timeout: 180000 });

test.describe('TEN: TenantAdmin panel', () => {
  const panel = new TenantAdminPanelSteps();
  let account: ActivatedTenantAdmin;

  test.beforeAll(async () => {
    account = await panel.prepareActivatedTenantAdmin();
  });

  test.afterAll(async () => {
    await panel.cleanup();
  });

  test('TEN-091: should edit the own tenant as a TenantAdmin', async ({ api }) => {
    await api.tenantManagement.editOwnTenantAsTenantAdmin(account);
  });

  test('TEN-092: should change the API credentials with the own password', async ({ api }) => {
    await api.tenantManagement.changeApiCredentialsAsTenantAdmin(account);
  });
});
