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
}
