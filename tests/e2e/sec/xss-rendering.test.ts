/**
 * Hostile text rendering: SEC-003.
 *
 * Four operators with hostile names (generated `QAX<code>` data, one per payload
 * kind) are created in `beforeAll` and always deleted in `afterAll`. The test keeps
 * the saved Administrator session (nothing is typed). File-level trace off.
 */

import type { GeneratedOperator, HostilePayloadKind } from '@data/types';

import { SecurityDataSteps } from '@steps/SecurityDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

const PAYLOAD_KINDS: HostilePayloadKind[] = ['img-onerror', 'script', 'svg-onload', 'attribute-break'];

test.describe('Hostile text rendering', () => {
  const dataSteps = new SecurityDataSteps();
  const operators: GeneratedOperator[] = [];

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      for (const kind of PAYLOAD_KINDS) {
        operators.push(await dataSteps.createHostileOperator(kind));
      }
    }
    catch (error) {
      await dataSteps.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    await dataSteps.cleanup();
  });

  test('SEC-003: should show hostile operator names as plain text without running them', async ({ ui }) => {
    await ui.operators.showHostileNamesAsPlainText(operators);
  });
});
