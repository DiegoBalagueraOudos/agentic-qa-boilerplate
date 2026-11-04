/**
 * KATA Architecture - Layer 3: Platform Configuration API Component (CFG cases)
 *
 * The two GLOBAL settings only the platform Administrator can change: the contingency switch and the failed-login
 * threshold of platform Administrators. Both survive the test, so every ATC reads the original value first and a
 * `finally` restores it and checks the read-back (the suite runs with one worker, so nothing else reads them meanwhile).
 *
 * Endpoints (relative to config.apiUrl, encrypted JSON bodies):
 * - GET /contingency          - the single contingency record (`IsActive`)
 * - PUT /contingency          - body `{ IsActive }`
 * - GET /SecurityConfig/lockout - `{ MaxFailedLoginAttempts }`
 * - PUT /SecurityConfig/lockout - body `{ MaxFailedLoginAttempts }` (an integer of 1 or more), IN CLEAR: the route is not among the encrypted paths
 *
 * Policy: the platform Administrator only; a TenantAdmin gets 403. CFG-008 (the threshold applied to a real lockout)
 * lives in `UsersApi`, next to the Admin lockout helpers of USR-009.
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, LockoutConfigData } from '@schemas/auth.types';
import type { ContingencyData } from '@schemas/resources.types';

import { SecureApi } from '@api/SecureApi';
import { expect, request as playwrightRequest } from '@playwright/test';
import { atc } from '@utils/decorators';

/** What an ATC finds before it changes anything. */
interface OriginalConfig {
  contingency: boolean
  lockout: number
}

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

export class PlatformConfigApi extends SecureApi {
  // ============================================
  // Helpers (no ATC)
  // ============================================

  /** Read the contingency record; asserts nothing. */
  async getContingency(): Promise<[APIResponse, ApiEnvelope<ContingencyData>]> {
    return this.secureGET<ContingencyData>('/contingency');
  }

  /** Set the contingency switch with ANY body; asserts nothing. */
  async attemptSetContingency(payload: object): Promise<[APIResponse, ApiEnvelope<ContingencyData>]> {
    return this.securePUT<ContingencyData, object>('/contingency', payload);
  }

  /** Read the global lockout threshold; asserts nothing. */
  async getLockout(): Promise<[APIResponse, ApiEnvelope<LockoutConfigData>]> {
    return this.secureGET<LockoutConfigData>('/SecurityConfig/lockout');
  }

  /** Set the global lockout threshold with ANY value (a number, a string...); asserts nothing. The route is outside the encrypted paths: the body goes in clear. */
  async attemptSetLockout(value: unknown): Promise<[APIResponse, ApiEnvelope<LockoutConfigData>]> {
    return this.securePUTPlain<LockoutConfigData, object>('/SecurityConfig/lockout', { MaxFailedLoginAttempts: value });
  }

  /** First line of an error, for a failure list (no stack, no call log, never a credential). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /**
   * Common frame of the CFG ATCs: one Administrator session, the original values read first (a failed read stops the ATC
   * before anything is changed), the body, then a restore of whatever differs and a check of the read-back.
   */
  private async runConfigCase(args: { what: string, body: (original: OriginalConfig, failures: string[]) => Promise<void> }): Promise<void> {
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      const [contingencyResponse, contingency] = await this.getContingency();
      const [lockoutResponse, lockout] = await this.getLockout();
      expect(contingencyResponse.status(), `read the original contingency: ${contingency.CodeError ?? 'no error code'}`).toBe(200);
      expect(lockoutResponse.status(), `read the original lockout threshold: ${lockout.CodeError ?? 'no error code'}`).toBe(200);
      const original: OriginalConfig = {
        contingency: contingency.Data?.IsActive ?? false,
        lockout: lockout.Data?.MaxFailedLoginAttempts ?? 0,
      };
      expect(original.lockout, 'the original lockout threshold is a positive integer').toBeGreaterThanOrEqual(1);

      try {
        await args.body(original, failures);
      }
      catch (error) {
        failures.push(`unexpected: ${this.firstLine(error)}`);
      }
      finally {
        failures.push(...await this.restore(original));
      }
    }
    catch (error) {
      failures.push(`setup: ${this.firstLine(error)}`);
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} ${args.what} checks failed. ${failures.join('; ')}`);
    }
  }

  /** Put both settings back to their original values and read them again. Returns one line per problem. */
  private async restore(original: OriginalConfig): Promise<string[]> {
    const problems: string[] = [];
    try {
      const [, contingency] = await this.getContingency();
      if (contingency.Data?.IsActive !== original.contingency) {
        await this.attemptSetContingency({ IsActive: original.contingency });
      }
      const [, lockout] = await this.getLockout();
      if (lockout.Data?.MaxFailedLoginAttempts !== original.lockout) {
        await this.attemptSetLockout(original.lockout);
      }
      const [, contingencyAfter] = await this.getContingency();
      const [, lockoutAfter] = await this.getLockout();
      verify(problems, contingencyAfter.Data?.IsActive === original.contingency, `RESTORE FAILED: contingency reads ${String(contingencyAfter.Data?.IsActive)} (expected ${original.contingency})`);
      verify(problems, lockoutAfter.Data?.MaxFailedLoginAttempts === original.lockout, `RESTORE FAILED: lockout threshold reads ${String(lockoutAfter.Data?.MaxFailedLoginAttempts)} (expected ${original.lockout})`);
    }
    catch (error) {
      problems.push(`RESTORE FAILED: ${this.firstLine(error)}`);
    }
    return problems;
  }

  // ============================================
  // Test Cases (ATCs): contingency (CFG-001, 002, 004)
  // ============================================

  /** CFG-001: the contingency state is readable: 200, a boolean `IsActive`, a record id, and a second read answers the same. */
  @atc('CFG-001')
  async readContingencyState(): Promise<void> {
    await this.runConfigCase({
      what: 'contingency read',
      body: async (_original, failures) => {
        const [response, body] = await this.getContingency();
        verify(failures, response.status() === 200 && body.Ok === true, `read: HTTP ${response.status()} ${body.CodeError ?? 'no error code'} (expected 200)`);
        verify(failures, typeof body.Data?.IsActive === 'boolean' && (body.Data.Id ?? 0) > 0, `read: IsActive=${String(body.Data?.IsActive)} Id=${String(body.Data?.Id)} (expected a boolean and a record id)`);
        const [, again] = await this.getContingency();
        verify(failures, again.Data?.IsActive === body.Data?.IsActive, 'a second read answers another state');
      },
    });
  }

  /**
   * CFG-002: switching the contingency persists. The switch is flipped, the answer and a fresh read show the new value with
   * `UpdatedBy` and `UpdatedAt` filled, and it is switched back. The audit entry (`ToggleContingency`) cannot be read through the
   * API, so it is not asserted (owner decision, 2026-11-04). The original value is restored in any case.
   */
  @atc('CFG-002')
  async switchContingencyAndKeepItPersisted(): Promise<void> {
    await this.runConfigCase({
      what: 'contingency switch',
      body: async (original, failures) => {
        for (const target of [!original.contingency, original.contingency]) {
          const [putResponse, put] = await this.attemptSetContingency({ IsActive: target });
          verify(failures, putResponse.status() === 200 && put.Ok === true && put.Data?.IsActive === target, `switch to ${target}: HTTP ${putResponse.status()} ${put.CodeError ?? 'no error code'}, answer IsActive=${String(put.Data?.IsActive)}`);
          const [, read] = await this.getContingency();
          verify(failures, read.Data?.IsActive === target, `after switching to ${target}, a fresh read shows ${String(read.Data?.IsActive)}`);
          verify(failures, (read.Data?.UpdatedBy ?? '') !== '' && (read.Data?.UpdatedAt ?? '') !== '', `after switching to ${target}, UpdatedBy=${String(read.Data?.UpdatedBy)} UpdatedAt=${String(read.Data?.UpdatedAt)} (expected both filled)`);
        }
      },
    });
  }

  /**
   * One TenantAdmin probe in its OWN request context: sign in, try `GET` and `PUT` on the contingency route, sign out.
   * Returns only statuses and the CSRF flag, never a token. Undecorated: the credentials are a secret.
   */
  private async probeContingencyAsTenantAdmin(toggleTo: boolean): Promise<{ get: number, put: number, csrf: boolean }> {
    const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    try {
      const probe = new PlatformConfigApi({ request: context });
      await probe.openCryptoSession();
      await probe.signInTenantUser({ UserName: this.config.tenantAdminUser.email, Password: this.config.tenantAdminUser.password });
      const [getResponse, getBody] = await probe.getContingency();
      const [putResponse, putBody] = await probe.attemptSetContingency({ IsActive: toggleTo });
      const csrf = [getBody, putBody].some(body => /csrf/i.test(`${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`));
      await probe.postLogout().catch(() => undefined);
      return { get: getResponse.status(), put: putResponse.status(), csrf };
    }
    finally {
      await context.dispose().catch(() => undefined);
    }
  }

  /**
   * CFG-004: a role that is not Administrator is refused. The real TenantAdmin (`config.tenantAdminUser`) signs in ONCE on its own
   * session and tries `GET` and `PUT` on the contingency: both must answer 403 (a CSRF 403 is inconclusive) and the switch keeps its value.
   */
  @atc('CFG-004')
  async refuseContingencyToTenantAdmin(): Promise<void> {
    await this.runConfigCase({
      what: 'contingency access',
      body: async (original, failures) => {
        const probe = await this.probeContingencyAsTenantAdmin(!original.contingency);
        verify(failures, !probe.csrf, 'inconclusive: a 403 carries the CSRF message, not the role one');
        verify(failures, probe.get === 403, `TenantAdmin GET /contingency: HTTP ${probe.get} (expected 403)`);
        verify(failures, probe.put === 403, `TenantAdmin PUT /contingency: HTTP ${probe.put} (expected 403)`);
        const [, after] = await this.getContingency();
        verify(failures, after.Data?.IsActive === original.contingency, 'the contingency changed after the refused PUT');
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): lockout threshold (CFG-005, 006, 007)
  // ============================================

  /** CFG-005: the global threshold is readable: 200, an integer of 1 or more, and a second read answers the same. */
  @atc('CFG-005')
  async readLockoutThreshold(): Promise<void> {
    await this.runConfigCase({
      what: 'lockout threshold read',
      body: async (_original, failures) => {
        const [response, body] = await this.getLockout();
        const value = body.Data?.MaxFailedLoginAttempts;
        verify(failures, response.status() === 200 && body.Ok === true, `read: HTTP ${response.status()} ${body.CodeError ?? 'no error code'} (expected 200)`);
        verify(failures, Number.isInteger(value) && (value ?? 0) >= 1, `read: MaxFailedLoginAttempts=${String(value)} (expected an integer of 1 or more)`);
        const [, again] = await this.getLockout();
        verify(failures, again.Data?.MaxFailedLoginAttempts === value, 'a second read answers another value');
      },
    });
  }

  /** CFG-006: the threshold can be set to 1, 5 and 100; each answer and a fresh read show the value. The original is restored. */
  @atc('CFG-006')
  async updateLockoutThreshold(): Promise<void> {
    await this.runConfigCase({
      what: 'lockout threshold update',
      body: async (_original, failures) => {
        for (const value of [1, 5, 100]) {
          const [putResponse, put] = await this.attemptSetLockout(value);
          verify(failures, putResponse.status() === 200 && put.Ok === true, `set ${value}: HTTP ${putResponse.status()} ${put.CodeError ?? 'no error code'} (expected 200) ${JSON.stringify(put).slice(0, 300)}`);
          const [, read] = await this.getLockout();
          verify(failures, read.Data?.MaxFailedLoginAttempts === value, `after setting ${value}, a fresh read shows ${String(read.Data?.MaxFailedLoginAttempts)}`);
        }
      },
    });
  }

  /**
   * CFG-007: a threshold of 0, -1 or text is refused (a 4xx, `Ok` not true; for the numbers the refusal names the minimum 1) and the
   * value does not change.
   */
  @atc('CFG-007')
  async rejectInvalidLockoutThresholds(): Promise<void> {
    await this.runConfigCase({
      what: 'invalid lockout threshold',
      body: async (original, failures) => {
        const rows: Array<{ label: string, value: unknown, numeric: boolean }> = [
          { label: '0', value: 0, numeric: true },
          { label: '-1', value: -1, numeric: true },
          { label: 'text', value: 'abc', numeric: false },
        ];
        for (const row of rows) {
          const [response, body] = await this.attemptSetLockout(row.value);
          const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])} ${JSON.stringify(body)}`;
          const refused = response.status() >= 400 && response.status() < 500 && body.Ok !== true;
          verify(failures, refused, `threshold ${row.label}: HTTP ${response.status()} Ok=${String(body.Ok)} (expected a 4xx refusal)`);
          if (refused && row.numeric) {
            verify(failures, /\b1\b/.test(text), `threshold ${row.label}: the refusal does not name the minimum of 1`);
          }
          const [, read] = await this.getLockout();
          verify(failures, read.Data?.MaxFailedLoginAttempts === original.lockout, `after threshold ${row.label}, the value reads ${String(read.Data?.MaxFailedLoginAttempts)} (expected ${original.lockout})`);
        }
      },
    });
  }
}
