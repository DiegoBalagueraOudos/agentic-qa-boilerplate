import { describe, expect, test } from 'bun:test';

import { VALID_TEST_ENVS, validateTestEnvironment } from './validateTestEnv';

describe('Validate test environments', () => {
  test('only declares the configured local environment', () => {
    expect(VALID_TEST_ENVS).toEqual(['local']);
    expect(() => validateTestEnvironment({ TEST_ENV: 'local', AUTO_SYNC: 'false' })).not.toThrow();
  });

  test('rejects an environment without a configured target', () => {
    expect(() => validateTestEnvironment({ TEST_ENV: 'staging', AUTO_SYNC: 'false' }))
      .toThrow('Unknown TEST_ENV: staging');
  });
});
