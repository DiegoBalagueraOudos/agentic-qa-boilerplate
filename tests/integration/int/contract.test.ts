/**
 * INT-006: the read routes of the API against its published contract.
 *
 * Mail-free. Empty storage state: the ATC opens its own crypto session, spends one positive Administrator login, creates an operator
 * and deletes it before it ends. A GENERATED tenant is prepared in `beforeAll` and deleted in `afterAll`. trace is off because the
 * login carries live tokens.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('INT: API contract', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('INT-006: should answer every read route as the contract says', async ({ api }) => {
    await api.contract.answerEveryReadRouteAsTheContractSays({ tenantId });
  });
});
