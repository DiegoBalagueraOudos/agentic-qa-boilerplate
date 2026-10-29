/**
 * SEC-012: the device endpoints (`synchronize`, `validation`, `tenants/{id}/devices`)
 * refuse access without credentials; `handshake` opens no session without a valid
 * client public key.
 *
 * Anonymous requests only: an empty storage state and no crypto session. The
 * malformed and tampered Bearer values are built locally; no real token is read.
 */

import { test } from '@TestFixture';

// trace off (top-level: Playwright forbids it in a describe): the requests carry
// a JWT-shaped Authorization header that must not end up in a trace.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('Security: device endpoints', () => {
  test('SEC-012: should refuse the device endpoints without credentials', async ({ api }) => {
    await api.access.refuseDeviceEndpointsWithoutCredentials();
  });
});
