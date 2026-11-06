/**
 * SMK-01: the public health endpoint.
 *
 * Anonymous: the endpoint needs no session, so the spec runs on an empty storage state. Needs Redis, PostgreSQL, MongoDB and
 * RabbitMQ up.
 */

import { test } from '@TestFixture';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Smoke: API health', () => {
  test('SMK-01: should report the API and every dependency as healthy', { tag: ['@critical'] }, async ({ api }) => {
    await api.health.reportEveryDependencyHealthy();
  });
});
