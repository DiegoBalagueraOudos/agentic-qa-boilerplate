/**
 * KATA Architecture - Layer 3: Concurrency API Component (CON cases)
 *
 * Simultaneous creates of the same record. The same create request is fired N times AT ONCE (`Promise.all`) on one
 * encrypted session (every request builds its own nonce), and the product must keep exactly ONE record: one answer is
 * a 200, every other one is a refusal (a 4xx, never a 5xx), and the list holds a single record with that identifier.
 * Everything a race manages to create is tracked BEFORE it is judged and deleted before the ATC ends.
 *
 * Entities: operator (CON-002) and branch, product, platform Administrator, tenant (CON-003), each with the unique key the
 * sequential cases already prove: operator code, branch code, product name, Administrator user name, tenant RNEC.
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope } from '@schemas/auth.types';

import { SecureApi } from '@api/SecureApi';
import { expect } from '@playwright/test';
import { atc } from '@utils/decorators';

/** What every create answers in `Data`: the id is `Id`, or `IdProduct` for a product. */
interface CreatedData {
  Id?: number
  IdProduct?: number
}

/** One entity a simultaneous create is tried on. */
interface RacedEntity {
  label: string
  /** The create request, with the SAME payload on every call. */
  create: () => Promise<[APIResponse, ApiEnvelope<CreatedData>]>
  remove: (id: number) => Promise<[APIResponse, ApiEnvelope<unknown>]>
  /** How many records hold the identifier that was sent. */
  count: () => Promise<number>
}

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

export class ConcurrencyApi extends SecureApi {
  // ============================================
  // Helpers (no ATC)
  // ============================================

  /** First line of an error, for a failure list (no stack, no call log, never a credential). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  private operatorRace(): RacedEntity {
    const payload = this.data.createPlainOperatorPayload();
    const code = payload.OperatorCode ?? '';
    return {
      label: 'operator',
      create: async () => this.securePOST<CreatedData, typeof payload>('/operators', payload),
      remove: async id => this.secureDELETE<unknown>(`/operators/${id}`),
      count: async () => {
        const [, body] = await this.secureGET<{ Data: Array<{ OperatorCode: string }> }>(`/operators?SearchTerm=${encodeURIComponent(code)}&PageSize=20`);
        return (body.Data?.Data ?? []).filter(row => row.OperatorCode.toUpperCase() === code.toUpperCase()).length;
      },
    };
  }

  private branchRace(tenantId: number): RacedEntity {
    const payload = this.data.createBranchPayload();
    return {
      label: 'branch',
      create: async () => this.securePOST<CreatedData, typeof payload>(`/tenants/${tenantId}/branches`, payload),
      remove: async id => this.secureDELETE<unknown>(`/tenants/${tenantId}/branches/${id}`),
      count: async () => {
        const [, body] = await this.secureGET<{ Data: Array<{ BranchCode: string }> }>(`/tenants/${tenantId}/branches?SearchTerm=${encodeURIComponent(payload.BranchCode)}&PageSize=20`);
        return (body.Data?.Data ?? []).filter(row => row.BranchCode === payload.BranchCode).length;
      },
    };
  }

  private productRace(tenantId: number): RacedEntity {
    const payload = this.data.createProductPayload();
    return {
      label: 'product',
      create: async () => this.securePOST<CreatedData, typeof payload>(`/tenant/${tenantId}/Product`, payload),
      remove: async id => this.secureDELETE<unknown>(`/tenant/${tenantId}/Product/${id}`),
      count: async () => {
        const [, body] = await this.secureGET<{ Data: Array<{ ProductName: string }> }>(`/tenant/${tenantId}/Product?SearchTerm=${encodeURIComponent(payload.ProductName)}&PageSize=20`);
        return (body.Data?.Data ?? []).filter(row => row.ProductName === payload.ProductName).length;
      },
    };
  }

  private administratorRace(): RacedEntity {
    const payload = this.data.createAdminPayload();
    const userName = payload.UserName ?? '';
    return {
      label: 'administrator',
      create: async () => this.securePOST<CreatedData, typeof payload>('/User', payload),
      remove: async id => this.secureDELETE<unknown>(`/User/${id}`),
      count: async () => {
        const [, body] = await this.secureGET<{ Data: Array<{ UserName: string }> }>(`/User?SearchTerm=${encodeURIComponent(userName)}&PageSize=20`);
        return (body.Data?.Data ?? []).filter(row => row.UserName === userName).length;
      },
    };
  }

  private tenantRace(): RacedEntity {
    const payload = this.data.createTenantPayload();
    const rnec = payload.Rnec ?? '';
    return {
      label: 'tenant',
      create: async () => this.securePOST<CreatedData, typeof payload>('/Tenant', payload),
      remove: async id => this.secureDELETE<unknown>(`/Tenant/${id}`),
      count: async () => {
        const [, body] = await this.secureGET<{ Data: Array<{ Rnec: string }> }>(`/Tenant?SearchTerm=${encodeURIComponent(rnec)}&PageSize=20`);
        return (body.Data?.Data ?? []).filter(row => row.Rnec === rnec).length;
      },
    };
  }

  /**
   * Fire `times` identical creates at once and judge the outcome: exactly one 200, every other answer a 4xx refusal (a 5xx is a
   * failure of its own), and one record holding the identifier. Every record the race created is deleted afterwards.
   */
  private async raceCreates(entity: RacedEntity, times: number, failures: string[]): Promise<void> {
    const answers = await Promise.all(Array.from({ length: times }, async () => entity.create().catch((error: unknown) => error)));
    const created: number[] = [];
    let accepted = 0;
    const refusals: string[] = [];
    for (const answer of answers) {
      if (answer instanceof Error || !Array.isArray(answer)) {
        failures.push(`${entity.label}: a simultaneous create failed to answer (${this.firstLine(answer)})`);
        continue;
      }
      const [response, body] = answer;
      const id = body.Data?.Id ?? body.Data?.IdProduct ?? 0;
      if (response.status() === 200 && id > 0) {
        accepted++;
        created.push(id);
      }
      else if (response.status() >= 400 && response.status() < 500 && body.Ok !== true) {
        refusals.push(String(response.status()));
      }
      else {
        failures.push(`${entity.label}: a simultaneous create answered HTTP ${response.status()} (expected 200 once and a 4xx refusal otherwise)`);
      }
    }
    try {
      verify(failures, accepted === 1, `${entity.label}: ${accepted} of ${times} simultaneous creates succeeded (expected exactly 1; refusals: ${refusals.join(',') || 'none'})`);
      const holders = await entity.count();
      verify(failures, holders === 1, `${entity.label}: ${holders} records hold the identifier after the race (expected 1)`);
    }
    finally {
      for (const id of created) {
        try {
          const [response] = await entity.remove(id);
          if (response.status() !== 200 && response.status() !== 404) {
            failures.push(`${entity.label}: delete #${id} answered HTTP ${response.status()}`);
          }
        }
        catch (error) {
          failures.push(`${entity.label}: delete #${id}: ${this.firstLine(error)}`);
        }
      }
    }
  }

  /** One Administrator session, collected failures, one thrown error. */
  private async runRaceCase(args: { what: string, body: (failures: string[]) => Promise<void> }): Promise<void> {
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      await args.body(failures);
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} ${args.what} checks failed. ${failures.join('; ')}`);
    }
  }

  // ============================================
  // Test Cases (ATCs)
  // ============================================

  /**
   * CON-002: five simultaneous creates of an operator with the same code. Exactly one answers 200, the other four are refused (a 4xx,
   * never a 5xx) and the operator list holds a single operator with that code. The operator is deleted afterwards.
   */
  @atc('CON-002')
  async createOnlyOneOperatorFromSimultaneousRequests(): Promise<void> {
    await this.runRaceCase({
      what: 'simultaneous operator creates',
      body: async failures => this.raceCreates(this.operatorRace(), 5, failures),
    });
  }

  /**
   * CON-003: a double submit (two identical creates at once) leaves ONE record, for a branch, a product, a platform Administrator and a
   * tenant. In each, exactly one answer is a 200, the other a 4xx refusal, and the list holds a single record with the identifier.
   */
  @atc('CON-003')
  async keepOneRecordOnDoubleSubmit(tenantId: number): Promise<void> {
    await this.runRaceCase({
      what: 'double submit',
      body: async (failures) => {
        for (const entity of [this.branchRace(tenantId), this.productRace(tenantId), this.administratorRace(), this.tenantRace()]) {
          await this.raceCreates(entity, 2, failures);
        }
      },
    });
  }

  /**
   * CON-001: two Administrators edit the same operator at the same time (two simultaneous `PUT` with different names). The product must
   * keep the edits apart: exactly one answers 200 and the other is refused with a 4xx conflict, and the operator ends with the name
   * of the one that was accepted. Answering 200 to both and keeping the last one without a warning is the lost update HAL-46 describes.
   * The operator is deleted afterwards.
   */
  @atc('CON-001')
  async refuseSimultaneousEditsOfTheSameOperator(): Promise<void> {
    await this.runRaceCase({
      what: 'simultaneous operator edits',
      body: async (failures) => {
        const payload = this.data.createPlainOperatorPayload();
        const [created, createdBody] = await this.securePOST<CreatedData, typeof payload>('/operators', payload);
        const id = createdBody.Data?.Id ?? 0;
        try {
          expect(created.status(), `control (create operator): ${createdBody.CodeError ?? 'no error code'}`).toBe(200);
          const names = [`QAX${payload.OperatorCode} editor A`, `QAX${payload.OperatorCode} editor B`];
          const answers = await Promise.all(names.map(async name => this.securePUT<unknown, { OperatorName: string }>(`/operators/${id}`, { OperatorName: name }).catch((error: unknown) => error)));
          const accepted: string[] = [];
          for (const [index, answer] of answers.entries()) {
            if (!Array.isArray(answer)) {
              failures.push(`edit ${names[index]}: no answer (${this.firstLine(answer)})`);
              continue;
            }
            const [response, body] = answer as [APIResponse, ApiEnvelope<unknown>];
            if (response.status() === 200 && body.Ok === true) {
              accepted.push(names[index]);
            }
            else if (!(response.status() >= 400 && response.status() < 500)) {
              failures.push(`edit ${names[index]}: HTTP ${response.status()} (expected 200 once and a 4xx conflict for the other)`);
            }
          }
          verify(failures, accepted.length === 1, `${accepted.length} of 2 simultaneous edits of the same operator were accepted (expected exactly 1 and a conflict for the other)`);
          const [, read] = await this.secureGET<{ OperatorName?: string }>(`/operators/${id}`);
          verify(failures, accepted.length !== 1 || read.Data?.OperatorName === accepted[0], 'the operator does not hold the name of the edit that was accepted');
        }
        finally {
          if (id > 0) {
            const [removed] = await this.secureDELETE<unknown>(`/operators/${id}`);
            if (![200, 404].includes(removed.status())) {
              failures.push(`delete operator #${id}: HTTP ${removed.status()}`);
            }
          }
        }
      },
    });
  }

  /** Whether the backend answers its health route right now (any failure, timeout or non-200 counts as down). */
  private async backendAnswers(): Promise<boolean> {
    try {
      const response = await this.request.get(`${this.config.apiUrl}/health`, { timeout: 3000, failOnStatusCode: false });
      return response.status() === 200;
    }
    catch {
      return false;
    }
  }

  /** Poll until the backend `wanted` state (up or down) shows, every second; returns false when `seconds` pass without it. */
  private async waitForBackend(wanted: boolean, seconds: number): Promise<boolean> {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      if ((await this.backendAnswers()) === wanted) {
        return true;
      }
      await new Promise<void>((resolve) => { setTimeout(resolve, 1000); });
    }
    return false;
  }

  /**
   * CON-005: the backend restarts while a session is open (the USER restarts it when the test asks: `docker restart validate-backend`).
   * After it is back, the old session is refused in a controlled way (401 with a `CRYPTO_SESSION_EXPIRED`-style code, never a 5xx) and the
   * client can recover without signing in again: a fresh handshake plus `POST /Auth/refresh` with the cookies it still holds answers 200.
   * It fails when the old session answers a 5xx or no code, or when the refresh cannot recover (the session is lost without a way back).
   */
  @atc('CON-005')
  async recoverSessionAfterBackendRestart(): Promise<void> {
    await this.runRaceCase({
      what: 'backend restart',
      body: async (failures) => {
        const [control] = await this.secureGET<unknown>('/Tenant?PageSize=1');
        expect(control.status(), 'control: the session works before the restart').toBe(200);
        console.error('[CON-005] RESTART THE BACKEND NOW (docker restart validate-backend). Waiting up to 120 s for it to go down...');
        expect(await this.waitForBackend(false, 120), 'the backend was never seen down: restart it while this test waits').toBe(true);
        console.error('[CON-005] Backend down. Waiting up to 180 s for it to come back...');
        expect(await this.waitForBackend(true, 180), 'the backend did not come back within 180 s').toBe(true);
        await new Promise<void>((resolve) => { setTimeout(resolve, 3000); });

        const [old, oldBody] = await this.secureGET<unknown>('/Tenant?PageSize=1');
        const oldCode = oldBody.CodeError ?? '';
        verify(failures, old.status() === 401 && /EXPIRED|SESSION/i.test(oldCode), `old session after the restart: HTTP ${old.status()} ${oldCode || 'no error code'} (expected 401 with a session-expired code)`);

        await this.openCryptoSession();
        const [refresh, refreshBody] = await this.securePOST<unknown, Record<string, never>>('/Auth/refresh', {});
        verify(failures, refresh.status() === 200 && refreshBody.Ok === true, `refresh with a fresh handshake after the restart: HTTP ${refresh.status()} ${refreshBody.CodeError ?? 'no error code'} (expected 200: recover without signing in again)`);
        if (refresh.status() === 200) {
          const [again] = await this.secureGET<unknown>('/Tenant?PageSize=1');
          verify(failures, again.status() === 200, `call after the refresh: HTTP ${again.status()} (expected 200)`);
        }
      },
    });
  }
}
