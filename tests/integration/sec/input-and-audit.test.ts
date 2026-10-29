/**
 * SEC data security: injection text in filters and forms (SEC-004) and the acting
 * user and date on critical changes (SEC-011).
 *
 * Empty storage state: each ATC opens its own crypto session and spends one positive
 * Administrator login. trace is off because the login carries live tokens. The data
 * is GENERATED (QAX-prefixed operators, a generated tenant) by `SecurityDataSteps`
 * in `beforeAll` and always deleted in `afterAll`; the ATCs only read it. SEC-004
 * sends a few failed logins to a username that does not exist and waits out the
 * shared address limiter before it ends.
 */

import type { AuditSubjects, InjectionControl } from '@api/DataSecurityApi';

import { SecurityDataSteps } from '@steps/SecurityDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('Security: input and audit', () => {
  const security = new SecurityDataSteps();
  let control: InjectionControl;
  let subjects: AuditSubjects;

  // No serial mode: a failing SEC-004 must not skip SEC-011. Playwright restarts the worker after a
  // failure and re-runs this hook there, so the data is created PER WORKER (fresh QAX codes, nothing
  // shared) and each worker's afterAll deletes its own copy.
  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      const injection = await security.createInjectionTextOperator();
      control = { id: injection.id, code: injection.code, name: injection.name };

      const audited = await security.createAuditedOperator();
      const forged = await security.createAuditedOperator();
      await security.updateOperatorWithForgedAuditField(forged.id);
      const tenant = await security.createAuditedTenant();
      subjects = { operatorId: audited.id, forgedOperatorId: forged.id, tenant };
    }
    catch (error) {
      await security.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    await security.cleanup();
  });

  test('SEC-004: should reject or neutralise injection text in filters and forms', async ({ api }) => {
    // Flow plus the ~31 s limiter wait in `finally` exceed the 60 s global timeout
    test.setTimeout(120000);
    await api.dataSecurity.rejectInjectionInFiltersAndForms(control);
  });

  test('SEC-011: should record the acting user and the date on critical changes', async ({ api }) => {
    await api.dataSecurity.recordActorAndDateOnCriticalChanges(subjects);
  });
});
