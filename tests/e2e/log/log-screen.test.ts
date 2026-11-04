/**
 * LOG screen cases: the Administrator "Log Consultas" screen (LOG-002, LOG-016).
 *
 * LOG-016 works on a GENERATED tenant with log rows inserted into the local Mongo (`LogsOperadorQA`, through Docker) in `beforeAll`
 * and deleted, with the tenant, in `afterAll`. It keeps the saved Administrator session. File-level trace off.
 */

import type { LogSeed } from '@steps/LogSeedSteps';

import { LogSeedSteps } from '@steps/LogSeedSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('LOG: Log Consultas screen', () => {
  const seeder = new LogSeedSteps();
  let tenant: { name: string, rnec: string };
  let seed: LogSeed;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      tenant = await seeder.prepareTenant();
      seed = seeder.seed(tenant.rnec);
    }
    catch (error) {
      await seeder.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    await seeder.cleanup();
  });

  test('LOG-002: should ask for a tenant and dates before querying', async ({ ui }) => {
    await ui.logs.requireTenantAndDatesBeforeQuerying();
  });

  test('LOG-016: should export the queries to a CSV inside a ZIP', async ({ ui }) => {
    await ui.logs.exportQueriesToCsv({ tenant, rows: seed.own['consultas-nr'] });
  });
});
