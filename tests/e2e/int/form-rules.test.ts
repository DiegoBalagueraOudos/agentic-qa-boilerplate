/**
 * INT screen cases: the login name column (INT-001), rules only the backend enforces (INT-002) and several validation errors at once
 * (INT-004).
 *
 * A GENERATED tenant with one user is prepared in `beforeAll` (no mail); the users, any operator a row creates by mistake and the tenant
 * are removed in `afterAll`. The cases keep the saved Administrator session. Typed values never reach a step title (`fillSecret`).
 * File-level trace off.
 */

import type { ServerOnlyRule } from '@ui/ContractsPage';

import { DataFactory } from '@DataFactory';
import { UiTenantSteps } from '@steps/UiTenantSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('INT: forms and the backend rules', () => {
  const tenants = new UiTenantSteps();
  const operatorCode = DataFactory.createOperatorCode();
  let tenantId = 0;
  let username = '';

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      tenantId = (await tenants.prepareTenant()).id;
      username = (await tenants.prepareUserApp(tenantId)).username;
    }
    catch (error) {
      await tenants.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    const failures: string[] = [];
    try {
      await tenants.removeOperators(operatorCode);
    }
    catch (error) {
      failures.push(String((error as Error).message).split('\n')[0]);
    }
    try {
      await tenants.cleanup();
    }
    catch (error) {
      failures.push(String((error as Error).message).split('\n')[0]);
    }
    if (failures.length > 0) {
      throw new Error(`cleanup incomplete: ${failures.join('; ')}`);
    }
  });

  /** A user the form accepts, with `overrides` on top. */
  const userValues = (overrides: Record<string, string>): Record<string, string> => ({
    fullName: 'QAX valid name',
    username: String(DataFactory.createUserAppPayload().UserName),
    password: DataFactory.createActivationPassword(),
    ...overrides,
  });
  const longText = (length: number): string => `QAX${'n'.repeat(length - 3)}`;

  test('INT-001: should show the login name in the Username column', async ({ ui }) => {
    await ui.contracts.showUsernameColumnOfUserApps({ tenantId, username });
  });

  test('INT-002: should show the rules only the backend enforces on their field', async ({ ui }) => {
    const rows: ServerOnlyRule[] = [
      { label: 'name of 61 characters', form: 'userapp', values: userValues({ fullName: longText(61) }), field: 'fullName' },
      { label: 'position of 101 characters', form: 'userapp', values: userValues({ position: longText(101) }), field: 'position' },
      { label: 'weak password', form: 'userapp', values: userValues({ password: 'abcdefgh' }), field: 'password' },
      { label: 'FTP service URL', form: 'operator', values: { operatorCode, operatorName: `QAX${operatorCode} plain`, serviceUrl: 'ftp://qa-sec.invalid/service' }, field: 'serviceUrl' },
    ];
    await ui.contracts.showServerOnlyRulesOnTheirField({ tenantId, rows });
  });

  test('INT-004: should show each validation error on its field', async ({ ui }) => {
    await ui.contracts.showEachValidationErrorOnItsField({
      tenantId,
      values: userValues({ fullName: longText(61), position: longText(101) }),
      invalidFields: 2,
    });
  });
});
