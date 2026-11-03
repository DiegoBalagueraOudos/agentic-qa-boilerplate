/**
 * UAP-012: UserApp CSV import with generated temporary credentials.
 *
 * Mail-free. The ATC opens its own crypto session (one positive Administrator login) and signs in once with a
 * GENERATED temporary credential, in its own request context. The import answer carries the temporary passwords:
 * nothing prints it. The upload is multipart (not encrypted) and the files are built in memory. trace is off because
 * the logins carry live tokens.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('UAP: userapp CSV import', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('UAP-012: should import UserApps from CSV with temporary credentials', async ({ api }) => {
    await api.userApps.importUserAppsFromCsv(tenantId);
  });
});
