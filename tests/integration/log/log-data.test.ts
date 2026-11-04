/**
 * LOG: log review on seeded rows (LOG-001, LOG-004, LOG-008, LOG-010, LOG-014, LOG-015, LOG-017).
 *
 * The log API is read-only, so `beforeAll` inserts known rows into the local Mongo (database `LogsOperadorQA`, through Docker) for
 * a generated tenant and a second client, and `afterAll` deletes them. A generated TenantAdmin (ONE welcome mail in the sandbox,
 * sent after the sandbox gap and removed in `afterAll`) reads the `mis-` views in LOG-017. Empty storage state; trace is off because
 * the logins carry live tokens.
 */

import type { LogSeed } from '@steps/LogSeedSteps';

import type { ActivatedTenantAdmin } from '@steps/TenantAdminPanelSteps';

import { LogSeedSteps } from '@steps/LogSeedSteps';
import { TenantAdminPanelSteps } from '@steps/TenantAdminPanelSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('LOG: log review on seeded rows', () => {
  const panel = new TenantAdminPanelSteps();
  const seeder = new LogSeedSteps();
  let account: ActivatedTenantAdmin;
  let seed: LogSeed;

  test.beforeAll(async () => {
    account = await panel.prepareActivatedTenantAdmin();
    seed = seeder.seed(account.rnec);
  });

  test.afterAll(async () => {
    const failures: string[] = [];
    try {
      await seeder.cleanup();
    }
    catch (error) {
      failures.push(String((error as Error).message).split('\n')[0]);
    }
    try {
      await panel.cleanup();
    }
    catch (error) {
      failures.push(String((error as Error).message).split('\n')[0]);
    }
    if (failures.length > 0) {
      throw new Error(`cleanup incomplete: ${failures.join('; ')}`);
    }
  });

  test('LOG-001: should list the logs of a client', async ({ api }) => {
    await api.logs.listLogsOfClient({ seed });
  });

  test('LOG-004: should filter the logs by date range', async ({ api }) => {
    await api.logs.filterLogsByDateRange({ seed });
  });

  test('LOG-008: should combine the log filters', async ({ api }) => {
    await api.logs.combineLogFilters({ seed });
  });

  test('LOG-010: should page the logs consistently', async ({ api }) => {
    await api.logs.pageLogsConsistently({ seed });
  });

  test('LOG-014: should read rows with null fields', async ({ api }) => {
    await api.logs.readLogsWithNullFields({ seed });
  });

  test('LOG-015: should show the stored values', async ({ api }) => {
    await api.logs.showStoredLogValues({ seed });
  });

  test('UAP-013: should let a UserApp read only the logs of its tenant', async ({ api }) => {
    await api.logs.readOnlyOwnTenantLogsAsUserApp({ seed, tenantId: account.tenantId });
  });

  test('LOG-017: should expose only the data a tenant user needs', async ({ api }) => {
    await api.logs.exposeOnlyNeededLogData({ seed, username: account.username, readPassword: account.readPassword });
  });
});
