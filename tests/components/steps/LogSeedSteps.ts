/**
 * KATA Architecture - Layer 3: Steps - seeded log database (LOG cases that need rows)
 *
 * The log API is read-only: the validation service writes the logs. These cases need known rows, so this class inserts them
 * straight into the local Mongo (database `LogsOperadorQA`, the one the backend reads) through `docker exec` and removes them
 * afterwards. Undecorated and instantiated directly (`new LogSeedSteps()`), not a fixture.
 *
 * What it seeds, per view (queries, requests, unsatisfactory responses): rows of the client (`clientId`, the RNEC of a generated
 * tenant) on consecutive days back from yesterday, one per day, and a few rows of another client. Every row id starts with
 * `QA-<token>-`: the token is unique per run, so `cleanup` deletes exactly what this run inserted and nothing else. The last row of
 * each client view has every optional field null (LOG-014). Operator and applicant ids carry the token too, so no real row matches.
 *
 * No secret is involved: the local Mongo answers without credentials. Nothing here logs a document.
 *
 * Usage: `seed(clientId)` in `beforeAll`, `cleanup()` in `afterAll`. Needs Docker and the container named below.
 */

import type { APIRequestContext } from '@playwright/test';

import { spawnSync } from 'node:child_process';
import { AuthApi } from '@api/AuthApi';
import { TenantsApi } from '@api/TenantsApi';
import { request as playwrightRequest } from '@playwright/test';
import { TestContext } from '@TestContext';

/** Container and database of the local environment (infrastructure names, not secrets). */
const MONGO_CONTAINER = 'validate-mongo';
const MONGO_DATABASE = 'LogsOperadorQA';

/** The three log views and their Mongo collection. */
export type SeededView = 'consultas-nr' | 'peticiones-nr' | 'respuestas-no-satisfactorias-nr';

const COLLECTIONS: Record<SeededView, string> = {
  'consultas-nr': 'LogConsultasNR',
  'peticiones-nr': 'LogPeticionesNR',
  'respuestas-no-satisfactorias-nr': 'LogRespuestanoSatisfactoriaNR',
};

/** One seeded log row; `OperationDate` is an ISO string (stored as a date). */
export type LogDoc = Record<string, string | number | number[] | null>;

/** What the cases need to know about the seeded rows. */
export interface LogSeed {
  token: string
  clientId: string
  otherClientId: string
  operators: { even: string, odd: string }
  applicants: { multipleOfFour: string, multipleOfThree: string, other: string }
  /** Rows of `clientId` per view, newest first. The last-numbered row has every optional field null. */
  own: Record<SeededView, LogDoc[]>
  /** Rows of `otherClientId` per view. */
  other: Record<SeededView, LogDoc[]>
}

/** Rows seeded for the client and for the other client, per view. */
const OWN_COUNTS: Record<SeededView, number> = { 'consultas-nr': 28, 'peticiones-nr': 12, 'respuestas-no-satisfactorias-nr': 6 };
const OTHER_COUNTS: Record<SeededView, number> = { 'consultas-nr': 5, 'peticiones-nr': 3, 'respuestas-no-satisfactorias-nr': 2 };

/** A generated tenant the rows belong to. */
export interface SeedTenant {
  id: number
  name: string
  rnec: string
}

export class LogSeedSteps extends TestContext {
  private token: string | null = null;
  private context: APIRequestContext | null = null;
  private auth: AuthApi | null = null;
  private tenants: TenantsApi | null = null;
  private tenantId: number | null = null;

  /** Create a generated tenant (no mail) on the own Administrator session; `cleanup` deletes it. */
  async prepareTenant(): Promise<SeedTenant> {
    const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    this.context = context;
    const auth = new AuthApi({ request: context });
    const tenants = new TenantsApi({ request: context });
    this.auth = auth;
    this.tenants = tenants;
    const [, , session] = await auth.startAdminSession({ UserName: this.config.testUser.email, Password: this.config.testUser.password });
    tenants.setCryptoSession(session);
    const payload = this.data.createTenantPayload();
    const [, body] = await tenants.createTenant(payload);
    this.tenantId = body.Data!.Id;
    return { id: this.tenantId, name: String(payload.BusinessName), rnec: String(payload.Rnec) };
  }

  /** Noon UTC of the day `days` back from today, as ISO text. */
  private noonDaysAgo(days: number): string {
    const base = new Date();
    base.setUTCHours(12, 0, 0, 0);
    return new Date(base.getTime() - days * 86_400_000).toISOString();
  }

  /** One row of a view; `nullRow` leaves every optional field null. */
  private buildDoc(view: SeededView, seed: Pick<LogSeed, 'token' | 'operators' | 'applicants'>, clientId: string, k: number, nullRow: boolean, tag: string): LogDoc {
    const common: LogDoc = { Id: `QA-${seed.token}-${tag}${k}`, ClientId: clientId, OperationDate: this.noonDaysAgo(k) };
    const operator = k % 2 === 0 ? seed.operators.even : seed.operators.odd;
    const applicant = k % 4 === 0 ? seed.applicants.multipleOfFour : (k % 3 === 0 ? seed.applicants.multipleOfThree : seed.applicants.other);
    if (view === 'consultas-nr') {
      return nullRow
        ? { ...common, SearchStatus: 0, RequestId: null, OperatorId: null, AplicantId: null, StartDate: null, EndtDate: null, IdFinger1: null, IdFinger2: null, FingerPrintFormat: null, StatusFinger1: null, StatusFinger2: null, ServerName: null, ServerIP: null, ServerMac: null, IdInscripcion: null }
        : { ...common, SearchStatus: 1, RequestId: `REQ-${seed.token}-${tag}${k}`, OperatorId: operator, AplicantId: applicant, StartDate: common.OperationDate, EndtDate: common.OperationDate, IdFinger1: k % 10, IdFinger2: (k + 1) % 10, FingerPrintFormat: 'WSQ', StatusFinger1: 'OK', StatusFinger2: 'OK', ServerName: `SRV-${k}`, ServerIP: `10.0.0.${k}`, ServerMac: `AA:BB:CC:00:00:${String(k).padStart(2, '0')}`, IdInscripcion: `INS-${k}` };
    }
    if (view === 'peticiones-nr') {
      return nullRow
        ? { ...common, OperatorId: null, AplicantId: null, FingersToGet: null, FingerPrintFormat: null, OpetarionDetails: null, UserCod: null, UserIP: null, UserMac: null, DpMovil: null, GdLatitud: null, GdLongitud: null, CodigoSede: null, IdInscripcion: null }
        : { ...common, OperatorId: operator, AplicantId: applicant, FingersToGet: [1, 2], FingerPrintFormat: 'ISO', OpetarionDetails: `detalle ${k}`, UserCod: `USR${k}`, UserIP: `10.1.0.${k}`, UserMac: `AA:BB:CC:01:00:${String(k).padStart(2, '0')}`, DpMovil: k % 2, GdLatitud: '4.6097', GdLongitud: '-74.0817', CodigoSede: `SEDE-${k}`, IdInscripcion: `INS-${k}` };
    }
    return nullRow
      ? { ...common, OperatorId: null, AplicantId: null, Score1: null, Score2: null, Minucia1: null, Minucia2: null, IdInscripcion: null }
      : { ...common, OperatorId: operator, AplicantId: applicant, Score1: '0.31', Score2: '0.27', Minucia1: `MIN1-${k}`, Minucia2: `MIN2-${k}`, IdInscripcion: `INS-${k}` };
  }

  /** Run a mongosh script on the log database through Docker; the script travels on stdin. Failure text carries no document. */
  private runScript(script: string): string {
    const result = spawnSync('docker', ['exec', '-i', MONGO_CONTAINER, 'mongosh', '--quiet', MONGO_DATABASE], { input: script, encoding: 'utf8', timeout: 60_000 });
    if (result.error || result.status !== 0) {
      throw new Error(`mongosh through docker failed (status ${String(result.status)}): ${(result.stderr || String(result.error)).split(/\r?\n/)[0].slice(0, 160)}`);
    }
    return result.stdout.trim();
  }

  /** Insert the rows of this run and return what was seeded. */
  seed(clientId: string): LogSeed {
    const token = this.data.createRnecOfLength(8);
    this.token = token;
    const base = {
      token,
      operators: { even: `QOE${token}`, odd: `QOO${token}` },
      applicants: { multipleOfFour: `QA4${token}`, multipleOfThree: `QA3${token}`, other: `QAX${token}` },
    };
    const otherClientId = `QB${token}`;
    const own = {} as Record<SeededView, LogDoc[]>;
    const other = {} as Record<SeededView, LogDoc[]>;
    for (const view of Object.keys(COLLECTIONS) as SeededView[]) {
      own[view] = Array.from({ length: OWN_COUNTS[view] }, (_, index) => this.buildDoc(view, base, clientId, index + 1, index + 1 === OWN_COUNTS[view], 'A'));
      other[view] = Array.from({ length: OTHER_COUNTS[view] }, (_, index) => this.buildDoc(view, base, otherClientId, index + 1, false, 'B'));
    }
    // The backend maps `Id` to `_id`, so the stored row has `_id` and no `Id` element
    const lines = ['const asDates = docs => docs.map(({ Id, ...d }) => ({ _id: Id, ...d, OperationDate: new Date(d.OperationDate), ...(d.StartDate ? { StartDate: new Date(d.StartDate) } : {}), ...(d.EndtDate ? { EndtDate: new Date(d.EndtDate) } : {}) }));'];
    for (const [view, name] of Object.entries(COLLECTIONS) as Array<[SeededView, string]>) {
      lines.push(`db.getCollection('${name}').insertMany(asDates(${JSON.stringify([...own[view], ...other[view]])}));`);
    }
    this.runScript(`${lines.join('\n')}\nprint('seeded');`);
    return { ...base, clientId, otherClientId, own, other };
  }

  /** Delete the rows of this run (and drop the collections that stay empty), then the generated tenant. Failures are reported together. */
  async cleanup(): Promise<void> {
    const failures: string[] = [];
    const firstLine = (error: unknown) => String((error as Error).message).split('\n')[0];
    if (this.token !== null) {
      const names = Object.values(COLLECTIONS).map(name => `'${name}'`).join(',');
      try {
        this.runScript(`[${names}].forEach(n => { const c = db.getCollection(n); c.deleteMany({ _id: { $regex: '^QA-${this.token}-' } }); if (c.countDocuments({}) === 0) c.drop(); });\nprint('cleaned');`);
      }
      catch (error) {
        failures.push(firstLine(error));
      }
      this.token = null;
    }
    if (this.tenants !== null && this.tenantId !== null) {
      try {
        const [response] = await this.tenants.attemptDeleteTenant(this.tenantId);
        if (![200, 400, 404].includes(response.status())) {
          failures.push(`delete tenant #${this.tenantId}: HTTP ${response.status()}`);
        }
      }
      catch (error) {
        failures.push(`delete tenant #${this.tenantId}: ${firstLine(error)}`);
      }
    }
    await this.auth?.logout().catch(() => undefined);
    await this.context?.dispose().catch(() => undefined);
    this.context = null;
    this.auth = null;
    this.tenants = null;
    this.tenantId = null;
    if (failures.length > 0) {
      throw new Error(`Log seed cleanup incomplete: ${failures.join('; ')}`);
    }
  }
}
