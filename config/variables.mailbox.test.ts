import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'bun:test';

// config/variables.ts reads process.env at import time, so each case loads it in
// a subprocess with a controlled env. Hermetic: the subprocess runs in an empty temp
// directory (no .env there, so `process.loadEnvFile()` has nothing to read) and gets
// only PATH, TEST_ENV and the variables passed in. The real .env is never reached.
const emptyDir = mkdtempSync(join(tmpdir(), 'mailbox-config-'));
afterAll(() => rmSync(emptyDir, { recursive: true, force: true }));
const variablesPath = `${import.meta.dir}/variables.ts`.replaceAll('\\', '/');

function readMailbox(env: Record<string, string>): { code: number | null, out: string } {
  const script = `import { config } from ${JSON.stringify(variablesPath)}; `
    + 'try { console.log(JSON.stringify({ ok: config.mailbox })); } '
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

describe('config.mailbox', () => {
  test('throws a named error without values when both variables are empty', () => {
    const { out } = readMailbox({ MAILTRAP_API_TOKEN: '', MAILTRAP_SANDBOX_ID: '' });
    const { err } = JSON.parse(out) as { err: string };
    expect(err).toContain('MAILTRAP_API_TOKEN');
    expect(err).toContain('MAILTRAP_SANDBOX_ID');
  });

  test('names only the missing token and leaks no value', () => {
    const { out } = readMailbox({ MAILTRAP_API_TOKEN: '', MAILTRAP_SANDBOX_ID: '9999999' });
    const { err } = JSON.parse(out) as { err: string };
    expect(err).toContain('MAILTRAP_API_TOKEN');
    expect(err).not.toContain('MAILTRAP_SANDBOX_ID');
    expect(err).not.toContain('9999999');
  });

  test('returns the token and the sandbox id when both are set', () => {
    const { out } = readMailbox({ MAILTRAP_API_TOKEN: 'fake-token-not-real', MAILTRAP_SANDBOX_ID: '9999999' });
    expect(JSON.parse(out)).toEqual({
      ok: { apiToken: 'fake-token-not-real', sandboxId: '9999999' },
    });
  });
});
