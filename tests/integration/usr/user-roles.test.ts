/**
 * USR-012: create and edit a platform role.
 *
 * Mail-free. The ATC opens its own crypto session (one positive root Administrator login). Roles are global, so every role
 * it creates is named `QAX...` and deactivated before it ends. Creating a role fails today (HAL-42), so the ATC reports it.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('USR: platform roles', () => {
  test('USR-012: should create and edit a role (name up to 50 characters)', async ({ api }) => {
    await api.roles.createAndEditRole();
  });
});
