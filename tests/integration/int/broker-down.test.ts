/**
 * INT-007: RabbitMQ is down. It needs the USER to stop the broker while the test runs, so it is skipped unless QA_BROKER_DOWN=1 is set;
 * the regular runs never touch it. Run it alone, in a terminal:
 *   docker stop validate-rabbitmq
 *   set QA_BROKER_DOWN=1 && bun run test tests/integration/int/broker-down.test.ts
 *   docker start validate-rabbitmq
 * A GENERATED tenant is prepared in `beforeAll` and deleted in `afterAll`. Each run leaves the download records the product creates
 * (they cannot be deleted through the API). Empty storage state; trace is off because the login carries live tokens.
 */

import { UiTenantSteps } from '@steps/UiTenantSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('INT: broker down', () => {
  const data = new UiTenantSteps();
  let rnec = '';

  test.beforeAll(async () => {
    test.skip(process.env.QA_BROKER_DOWN?.trim() !== '1', 'Set QA_BROKER_DOWN=1 after stopping RabbitMQ');
    rnec = (await data.prepareTenant()).rnec;
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('INT-007: should answer an ATDP export in a controlled way with the broker down', async ({ api }) => {
    await api.contract.keepExportRequestControlledWhenBrokerIsDown({ rnec });
  });
});
