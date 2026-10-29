import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'bun:test';

// config/variables.ts reads process.env at import time, so each case loads it in
// a subprocess with a controlled env. Hermetic: the subprocess runs in an empty temp
// directory (no .env there, so `process.loadEnvFile()` has nothing to read) and gets
// only PATH, TEST_ENV and the variables passed in. The real .env is never reached.
const emptyDir = mkdtempSync(join(tmpdir(), 'tenant-admin-config-'));
afterAll(() => rmSync(emptyDir, { recursive: true, force: true }));
const variablesPath = `${import.meta.dir}/variables.ts`.replaceAll('\\', '/');

function readTenantAdmin(env: Record<string, string>): { code: number | null, out: string } {
  const script = `import { config } from ${JSON.stringify(variablesPath)}; `
    + 'try { console.log(JSON.stringify({ ok: config.tenantAdminUser })); } '
    + 'catch (e) { console.log(JSON.stringify({ err: String(e) })); }';
  const proc = Bun.spawnSync([process.execPath, '--no-env-file', '-e', script], {
    cwd: emptyDir,
    env: { PATH: process.env.PATH ?? '', TEST_ENV: 'local', ...env },
  });
  const out = proc.stdout.toString().trim().split('\n').pop() ?? '';
  // A subprocess that did not even print a result (bun missing, import threw) must say so,
  // instead of surfacing later as an opaque JSON.parse error.
  expect(out, `subprocess printed nothing (exit ${String(proc.exitCode)}): ${proc.stderr.toString().slice(0, 200)}`).not.toBe('');
  return { code: proc.exitCode, out };
}

describe('config.tenantAdminUser', () => {
  test('throws a named error without values when both variables are empty', () => {
    const { out } = readTenantAdmin({ LOCAL_TENANT_ADMIN_EMAIL: '', LOCAL_TENANT_ADMIN_PASSWORD: '' });
    const { err } = JSON.parse(out) as { err: string };
    expect(err).toContain('LOCAL_TENANT_ADMIN_EMAIL');
    expect(err).toContain('LOCAL_TENANT_ADMIN_PASSWORD');
  });

  test('names only the missing half and leaks no value', () => {
    const { out } = readTenantAdmin({ LOCAL_TENANT_ADMIN_EMAIL: 'fake.admin@example.test', LOCAL_TENANT_ADMIN_PASSWORD: '' });
    const { err } = JSON.parse(out) as { err: string };
    expect(err).toContain('LOCAL_TENANT_ADMIN_PASSWORD');
    expect(err).not.toContain('fake.admin@example.test');
  });

  test('returns the pair when both are set', () => {
    const { out } = readTenantAdmin({
      LOCAL_TENANT_ADMIN_EMAIL: 'fake.admin@example.test',
      LOCAL_TENANT_ADMIN_PASSWORD: 'fake-password-not-real',
    });
    expect(JSON.parse(out)).toEqual({
      ok: { email: 'fake.admin@example.test', password: 'fake-password-not-real' },
    });
  });
});
