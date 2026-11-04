/**
 * CON concurrency: simultaneous creates of the same record (CON-002 operators, CON-003 double submit).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive Administrator login; the generated
 * tenant (for the branch and the product of CON-003) is prepared in `beforeAll` and deleted in `afterAll`. Every record a race
 * creates is deleted before the ATC ends. trace is off because the logins carry live tokens.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('CON: concurrent creates', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('CON-002: should create only one operator from simultaneous requests', async ({ api }) => {
    await api.concurrency.createOnlyOneOperatorFromSimultaneousRequests();
  });

  test('CON-003: should keep one record on a double submit', async ({ api }) => {
    await api.concurrency.keepOneRecordOnDoubleSubmit(tenantId);
  });
});
