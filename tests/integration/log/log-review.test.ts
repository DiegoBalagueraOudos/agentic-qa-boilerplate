/**
 * LOG: log review that needs no seeded data (LOG-003, LOG-005, LOG-006, LOG-007, LOG-009, LOG-011, LOG-012, LOG-019, LOG-020).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive Administrator login; LOG-003 also signs
 * in a generated TenantAdmin (one welcome mail in the sandbox) and a generated UserApp on their own contexts (one positive login each). The log database (Mongo)
 * is empty here and the API cannot write to it, so the cases that need seeded rows (LOG-001, 004, 008, 010, 014 to 018) stay pending
 * and LOG-013 and LOG-018 are manual. LOG-020 leaves one ATDP download record per run. trace is off because the logins carry live tokens.
 */

import type { ActivatedTenantAdmin } from '@steps/TenantAdminPanelSteps';

import { TenantAdminPanelSteps } from '@steps/TenantAdminPanelSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('LOG: log review', () => {
  const panel = new TenantAdminPanelSteps();
  let account: ActivatedTenantAdmin;

  // LOG-003 needs a TenantAdmin on a tenant without a log database: ONE welcome mail, sent after the sandbox gap and removed in afterAll
  test.beforeAll(async () => {
    account = await panel.prepareActivatedTenantAdmin();
  });

  test.afterAll(async () => {
    await panel.cleanup();
  });

  test('LOG-003: should isolate the logs per tenant', async ({ api }) => {
    await api.logs.isolateLogsPerTenant(account);
  });

  test('LOG-005: should reject inverted and future dates', async ({ api }) => {
    await api.logs.rejectInvertedAndFutureDates();
  });

  test('LOG-006: should limit the date range to 730 days', async ({ api }) => {
    await api.logs.limitDateRangeTo730Days();
  });

  test('LOG-007: should define the behaviour without dates', async ({ api }) => {
    await api.logs.defineBehaviourWithoutDates();
  });

  test('LOG-009: should resist filter injection', async ({ api }) => {
    await api.logs.resistFilterInjection();
  });

  test('LOG-011: should answer an empty result', async ({ api }) => {
    await api.logs.answerEmptyResult();
  });

  test('LOG-012: should read the logs of a tenant without a log database', async ({ api }) => {
    await api.logs.readLogsOfTenantWithoutLogDatabase();
  });

  test('LOG-019: should list the devices without association', async ({ api }) => {
    await api.logs.listDevicesWithoutAssociation();
  });

  test('LOG-020: should request an ATDP export', async ({ api }) => {
    await api.logs.requestAtdpExport();
  });
});
