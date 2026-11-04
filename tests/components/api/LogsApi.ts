/**
 * KATA Architecture - Layer 3: Logs API Component (LOG cases)
 *
 * Log review of the Non-Repudiation services: three views (queries `consultas-nr`, requests `peticiones-nr`, unsatisfactory responses
 * `respuestas-no-satisfactorias-nr`), each with an Administrator route (all tenants, `ClientId` picks the tenant) and a `mis-` route
 * for tenant users (only their own tenant). Helpers named `attempt*` and `list*` assert nothing and return the raw answer.
 *
 * Endpoints (relative to config.apiUrl, encrypted JSON bodies):
 * - GET /logs/{view}              - Administrator; filters Page, PageSize, SearchTerm, ClientId, AplicantId, OperatorId, StartDate, EndDate
 * - GET /logs/mis-{view}          - tenant user (TenantAdmin or UserApp); the tenant comes from the session
 *
 * Secret handling: log rows carry minutiae and scores; no failure message prints a row, only counts and ids.
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, CreatedEntityData } from '@schemas/auth.types';
import type { TenantFullData } from '@schemas/resources.types';
import type { PagedData } from '@schemas/security.types';
import type { LogDoc, LogSeed } from '@steps/LogSeedSteps';

import { SecureApi } from '@api/SecureApi';
import { expect, request as playwrightRequest } from '@playwright/test';
import { atc } from '@utils/decorators';

/** The three log views. */
export type LogView = 'consultas-nr' | 'peticiones-nr' | 'respuestas-no-satisfactorias-nr';

/** Filters of a log query; every field is optional. */
export interface LogQuery {
  page?: number
  pageSize?: number
  searchTerm?: string
  clientId?: string
  aplicantId?: string
  operatorId?: string
  startDate?: string
  endDate?: string
}

/** The fields the checks read from a log row; the rest of the row is not used. */
export interface LogRow {
  Id: string
  ClientId?: string | null
  AplicantId?: string | null
  OperatorId?: string | null
  OperationDate?: string | null
  StartDate?: string | null
}

export const LOG_VIEWS: LogView[] = ['consultas-nr', 'peticiones-nr', 'respuestas-no-satisfactorias-nr'];

/** A principal that reads the `mis-` routes: login name and password, read by name. */
interface LogPrincipal {
  userName: string
  password: string
}

/** One alert of the devices without a branch or a MAC. */
interface DeviceAlert {
  Id: number
  MissingMac: boolean
  MissingBranch: boolean
}

/** One ATDP export request. */
interface AtdpDownload {
  Id: number
  ClientId: string
  Status: string
}

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

/** A calendar date (`YYYY-MM-DD`, UTC) `days` away from today; negative is the past. */
function dateAway(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export class LogsApi extends SecureApi {
  // ============================================
  // Helpers (no ATC)
  // ============================================

  /** Query string of a log query. */
  private queryString(query: LogQuery): string {
    const params = new URLSearchParams();
    const pairs: Array<[string, string | number | undefined]> = [
      ['Page', query.page],
      ['PageSize', query.pageSize],
      ['SearchTerm', query.searchTerm],
      ['ClientId', query.clientId],
      ['AplicantId', query.aplicantId],
      ['OperatorId', query.operatorId],
      ['StartDate', query.startDate],
      ['EndDate', query.endDate],
    ];
    for (const [key, value] of pairs) {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    }
    const text = params.toString();
    return text === '' ? '' : `?${text}`;
  }

  /** One log view as the Administrator (`mine` false) or as a tenant user (`mine` true); asserts nothing. */
  async listLogs(view: LogView, query: LogQuery = {}, mine = false): Promise<[APIResponse, ApiEnvelope<PagedData<LogRow>>]> {
    return this.secureGET<PagedData<LogRow>>(`/logs/${mine ? 'mis-' : ''}${view}${this.queryString(query)}`);
  }

  /** First line of an error, for a failure list (no stack, no call log, never a credential). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /** Text of the error part of an answer. */
  private errorText(body: ApiEnvelope<unknown>): string {
    return `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
  }

  /** Frame of the LOG ATCs: one Administrator session, collected failures, one thrown error. */
  private async runLogCase(args: { what: string, body: (failures: string[]) => Promise<void> }): Promise<void> {
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

  /** Create a tenant and return its id and RNEC. The id is recorded BEFORE the answer is judged. */
  private async createTenantFor(tenantIds: number[]): Promise<{ id: number, rnec: string }> {
    const payload = this.data.createTenantPayload();
    const [response, body] = await this.securePOST<CreatedEntityData, object>('/Tenant', payload);
    const id = body.Data?.Id ?? 0;
    if (id > 0) {
      tenantIds.push(id);
    }
    expect(response.status(), `control (create tenant): ${body.CodeError ?? 'no error code'}`).toBe(200);
    return { id, rnec: String(payload.Rnec) };
  }

  /** Delete generated tenants, tolerating the ones already gone. Returns one line per failure. */
  private async deleteTenants(tenantIds: number[]): Promise<string[]> {
    const failures: string[] = [];
    for (const id of tenantIds) {
      const [response] = await this.secureDELETE<unknown>(`/Tenant/${id}`);
      if (![200, 400, 404].includes(response.status())) {
        failures.push(`delete tenant #${id}: HTTP ${response.status()}`);
      }
    }
    return failures;
  }

  /**
   * Sign in once as a tenant user on its OWN context (own cookie jar and crypto session: the Administrator session of the ATC is
   * left alone), run the callback with that probe and sign out. Undecorated: the credentials are a secret.
   */
  private async asTenantUser<T>(principal: LogPrincipal, run: (probe: LogsApi) => Promise<T>): Promise<T> {
    const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    try {
      const probe = new LogsApi({ request: context });
      await probe.openCryptoSession();
      await probe.signInTenantUser({ UserName: principal.userName, Password: principal.password });
      try {
        return await run(probe);
      }
      finally {
        await probe.postLogout().catch(() => undefined);
      }
    }
    finally {
      await context.dispose().catch(() => undefined);
    }
  }

  // ============================================
  // Test Cases (ATCs): date filters
  // ============================================

  /**
   * LOG-005: a start date after the end date and an end date in the future are refused with 400 in the three views. A valid range
   * is the control and answers 200.
   */
  @atc('LOG-005')
  async rejectInvertedAndFutureDates(): Promise<void> {
    await this.runLogCase({
      what: 'log date validation',
      body: async (failures) => {
        for (const view of LOG_VIEWS) {
          const [control] = await this.listLogs(view, { startDate: dateAway(-10), endDate: dateAway(-1) });
          expect(control.status(), `control (${view}): a valid range answers 200`).toBe(200);
          const rows = [
            { label: 'start after end', query: { startDate: dateAway(-1), endDate: dateAway(-10) } },
            { label: 'end in the future', query: { startDate: dateAway(-10), endDate: dateAway(30) } },
          ];
          for (const row of rows) {
            const [response, body] = await this.listLogs(view, row.query);
            verify(failures, response.status() === 400 && body.Ok === false, `${view}, ${row.label}: HTTP ${response.status()} Ok=${String(body.Ok)} ${body.CodeError ?? 'no error code'} (expected 400)`);
          }
        }
      },
    });
  }

  /** LOG-006: a range of 730 days is accepted (200) and one of 731 days is refused (400) in the three views. */
  @atc('LOG-006')
  async limitDateRangeTo730Days(): Promise<void> {
    await this.runLogCase({
      what: 'log date range limit',
      body: async (failures) => {
        const end = dateAway(-1);
        for (const view of LOG_VIEWS) {
          const [accepted, acceptedBody] = await this.listLogs(view, { startDate: dateAway(-731), endDate: end });
          verify(failures, accepted.status() === 200 && acceptedBody.Ok === true, `${view}, 730 days: HTTP ${accepted.status()} ${acceptedBody.CodeError ?? 'no error code'} (expected 200)`);
          const [refused, refusedBody] = await this.listLogs(view, { startDate: dateAway(-732), endDate: end });
          verify(failures, refused.status() === 400 && refusedBody.Ok === false, `${view}, 731 days: HTTP ${refused.status()} Ok=${String(refusedBody.Ok)} (expected 400)`);
        }
      },
    });
  }

  /**
   * LOG-007: with no dates the answer is defined (200, or a 4xx that asks for them), never a 5xx; and the range limit cannot be
   * skipped by sending one date only: a start date three years back with no end date is refused (400).
   */
  @atc('LOG-007')
  async defineBehaviourWithoutDates(): Promise<void> {
    await this.runLogCase({
      what: 'log queries without dates',
      body: async (failures) => {
        for (const view of LOG_VIEWS) {
          const [none, noneBody] = await this.listLogs(view);
          verify(failures, [200, 400].includes(none.status()) && (none.status() !== 200 || noneBody.Ok === true), `${view}, no dates: HTTP ${none.status()} Ok=${String(noneBody.Ok)} (expected a defined answer, 200 or 400)`);
          const [startOnly, startBody] = await this.listLogs(view, { startDate: dateAway(-1100) });
          verify(failures, startOnly.status() === 400 && startBody.Ok === false, `${view}, only a start date 1100 days back: HTTP ${startOnly.status()} Ok=${String(startBody.Ok)} (expected 400: the range limit must still apply)`);
        }
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): filters, empty result, tenant without a log database
  // ============================================

  /**
   * LOG-009: filters with regular-expression and Mongo-operator text answer 200 with no error, and a filter that holds such text
   * matches nothing (no row is returned for `ClientId`, `OperatorId` or `AplicantId`).
   */
  @atc('LOG-009')
  async resistFilterInjection(): Promise<void> {
    await this.runLogCase({
      what: 'log filter injection',
      body: async (failures) => {
        const texts = ['.*', '{"$ne":null}', '[$ne]=1', '{"$gt":""}', '\' || 1==1 || \'', '"quoted"', '$where: 1'];
        for (const view of LOG_VIEWS) {
          for (const text of texts) {
            const queries: Array<{ label: string, query: LogQuery, mustBeEmpty: boolean }> = [
              { label: 'SearchTerm', query: { searchTerm: text }, mustBeEmpty: false },
              { label: 'ClientId', query: { clientId: text }, mustBeEmpty: true },
              { label: 'OperatorId', query: { operatorId: text }, mustBeEmpty: true },
              { label: 'AplicantId', query: { aplicantId: text }, mustBeEmpty: true },
            ];
            for (const row of queries) {
              try {
                const [response, body] = await this.listLogs(view, row.query);
                const rows = body.Data?.Data.length ?? 0;
                verify(failures, response.status() === 200 && body.Ok === true, `${view}, ${row.label}=${text}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'} (expected 200)`);
                verify(failures, !row.mustBeEmpty || rows === 0, `${view}, ${row.label}=${text}: ${rows} row(s) returned (expected none: the text is a literal)`);
              }
              catch (error) {
                failures.push(`${view}, ${row.label}=${text}: no controlled answer (${this.firstLine(error)})`);
              }
            }
          }
        }
      },
    });
  }

  /** LOG-011: filters that match nothing answer 200 with an empty page (`TotalRecords` 0) in the three views. */
  @atc('LOG-011')
  async answerEmptyResult(): Promise<void> {
    await this.runLogCase({
      what: 'empty log result',
      body: async (failures) => {
        const token = `ZZ${this.data.createRnecOfLength(12)}`;
        const queries: Array<{ label: string, query: LogQuery }> = [
          { label: 'SearchTerm with no match', query: { searchTerm: token } },
          { label: 'ClientId with no match', query: { clientId: token } },
          { label: 'OperatorId with no match', query: { operatorId: token } },
          { label: 'AplicantId with no match', query: { aplicantId: token } },
          { label: 'all filters together', query: { searchTerm: token, clientId: token, operatorId: token, aplicantId: token } },
        ];
        for (const view of LOG_VIEWS) {
          for (const row of queries) {
            const [response, body] = await this.listLogs(view, row.query);
            verify(failures, response.status() === 200 && body.Ok === true && (body.Data?.Data.length ?? -1) === 0 && (body.Data?.TotalRecords ?? -1) === 0, `${view}, ${row.label}: HTTP ${response.status()}, ${body.Data?.Data.length ?? 'no'} rows, total ${String(body.Data?.TotalRecords)} (expected 200, no rows, total 0)`);
          }
        }
      },
    });
  }

  /**
   * LOG-012: a tenant with no log database of its own (`LogDbConfigured` false) is read from the Administrator views with a
   * controlled answer: 200 and an empty page in the three views, never an error.
   */
  @atc('LOG-012')
  async readLogsOfTenantWithoutLogDatabase(): Promise<void> {
    await this.runLogCase({
      what: 'tenant without log database',
      body: async (failures) => {
        const tenantIds: number[] = [];
        try {
          const { id, rnec } = await this.createTenantFor(tenantIds);
          const [, read] = await this.secureGET<TenantFullData>(`/Tenant/${id}`);
          expect(read.Data?.LogDbConfigured, 'control: the generated tenant has no log database').toBe(false);
          for (const view of LOG_VIEWS) {
            const [response, body] = await this.listLogs(view, { clientId: rnec });
            verify(failures, response.status() === 200 && body.Ok === true && Array.isArray(body.Data?.Data), `${view}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'} (expected a controlled 200)`);
          }
        }
        finally {
          failures.push(...await this.deleteTenants(tenantIds));
        }
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): access by tenant, alerts and ATDP
  // ============================================

  /**
   * LOG-003: tenant users see only their own tenant. A GENERATED TenantAdmin (with its own generated tenant) and a UserApp of a second
   * GENERATED tenant read the `mis-` views
   * (200, every row of their own tenant, also when they send another tenant's `ClientId`), are refused on the Administrator views and
   * on the ATDP downloads (403), and the TenantAdmin is refused the alerts of another tenant (403). The suite's real TenantAdmin is not
   * used: its tenant has a log database that does not answer and every `mis-` read waits 30 s. The row checks hold trivially while
   * the log database is empty and become real as soon as it is seeded.
   */
  @atc('LOG-003')
  async isolateLogsPerTenant(args: { username: string, readPassword: () => Promise<string> }): Promise<void> {
    await this.runLogCase({
      what: 'log isolation per tenant',
      body: async (failures) => {
        const tenantIds: number[] = [];
        try {
          const foreign = await this.createTenantFor(tenantIds);
          const userApp = this.data.createUserAppPayload();
          const [created, createdBody] = await this.securePOST<CreatedEntityData, object>(`/tenants/${foreign.id}/appusers`, userApp);
          expect(created.status(), `control (create UserApp): ${createdBody.CodeError ?? 'no error code'}`).toBe(200);

          const check = async (probe: LogsApi, label: string, ownRnec: string, otherRnec: string) => {
            for (const view of LOG_VIEWS) {
              for (const clientId of [undefined, otherRnec]) {
                const what = `${label}, mis-${view}${clientId === undefined ? '' : ' with another ClientId'}`;
                try {
                  const [response, body] = await probe.listLogs(view, clientId === undefined ? {} : { clientId }, true);
                  const outsiders = (body.Data?.Data ?? []).filter(row => row.ClientId !== ownRnec).length;
                  verify(failures, response.status() === 200 && body.Ok === true && outsiders === 0, `${what}: HTTP ${response.status()}, ${outsiders} row(s) of another tenant (expected 200 and none)`);
                }
                catch (error) {
                  failures.push(`${what}: no answer (${this.firstLine(error)})`);
                }
              }
              try {
                const [refused, refusedBody] = await probe.listLogs(view);
                verify(failures, refused.status() === 403 && refusedBody.Ok === false, `${label}, Administrator view ${view}: HTTP ${refused.status()} (expected 403)`);
              }
              catch (error) {
                failures.push(`${label}, Administrator view ${view}: no answer (${this.firstLine(error)})`);
              }
            }
            try {
              const [downloads, downloadsBody] = await probe.secureGET<unknown>('/logs/atdp/downloads');
              verify(failures, downloads.status() === 403 && downloadsBody.Ok === false, `${label}, ATDP downloads: HTTP ${downloads.status()} (expected 403)`);
            }
            catch (error) {
              failures.push(`${label}, ATDP downloads: no answer (${this.firstLine(error)})`);
            }
          };

          await this.asTenantUser({ userName: String(userApp.UserName), password: String(userApp.Password) }, async (probe) => {
            await check(probe, 'UserApp', foreign.rnec, 'OTHERTENANT');
          });
          const generated = { userName: args.username, password: await args.readPassword() };
          await this.asTenantUser(generated, async (probe) => {
            const [, mine] = await probe.secureGET<TenantFullData>('/Tenant/my-tenant');
            const ownRnec = mine.Data?.Rnec ?? '';
            expect(ownRnec, 'control: the TenantAdmin reads its own tenant').not.toBe('');
            expect(ownRnec, 'the foreign tenant must not be the own tenant of the TenantAdmin').not.toBe(foreign.rnec);
            await check(probe, 'TenantAdmin', ownRnec, foreign.rnec);
            const [alerts, alertsBody] = await probe.secureGET<unknown>(`/tenants/${foreign.id}/devices/alerts/sin-asociacion`);
            verify(failures, alerts.status() === 403 && alertsBody.Ok === false, `TenantAdmin, alerts of another tenant: HTTP ${alerts.status()} ${alertsBody.CodeError ?? 'no error code'} (expected 403)`);
          });
        }
        finally {
          failures.push(...await this.deleteTenants(tenantIds));
        }
      },
    });
  }

  /**
   * LOG-019: the alert of devices without a branch or a MAC. A device on an active terminal with a MAC and an active branch is not in
   * the alert (control); once its terminal is deactivated (and the device enabled again) the alert lists it with `MissingMac`.
   */
  @atc('LOG-019')
  async listDevicesWithoutAssociation(): Promise<void> {
    await this.runLogCase({
      what: 'devices without association alert',
      body: async (failures) => {
        const tenantIds: number[] = [];
        const children: string[] = [];
        try {
          const { id: tenantId } = await this.createTenantFor(tenantIds);
          const [branch, branchBody] = await this.securePOST<CreatedEntityData, object>(`/tenants/${tenantId}/branches`, this.data.createBranchPayload());
          const branchId = branchBody.Data?.Id ?? 0;
          expect(branch.status(), 'control (create branch)').toBe(200);
          children.push(`/tenants/${tenantId}/branches/${branchId}`);
          const [terminal, terminalBody] = await this.securePOST<CreatedEntityData, object>(`/tenants/${tenantId}/terminals`, this.data.createTerminalPayload(branchId));
          const terminalId = terminalBody.Data?.Id ?? 0;
          expect(terminal.status(), 'control (create terminal)').toBe(200);
          children.unshift(`/tenants/${tenantId}/terminals/${terminalId}`);
          const [device, deviceBody] = await this.securePOST<CreatedEntityData, object>(`/tenants/${tenantId}/devices`, this.data.createDevicePayload(terminalId));
          const deviceId = deviceBody.Data?.Id ?? 0;
          expect(device.status(), 'control (create device)').toBe(200);
          children.unshift(`/tenants/${tenantId}/devices/${deviceId}`);

          const read = async () => this.secureGET<DeviceAlert[]>(`/tenants/${tenantId}/devices/alerts/sin-asociacion`);
          const [before, beforeBody] = await read();
          verify(failures, before.status() === 200 && Array.isArray(beforeBody.Data) && !(beforeBody.Data).some(alert => alert.Id === deviceId), `associated device: HTTP ${before.status()}, listed ${String((beforeBody.Data ?? []).some(alert => alert.Id === deviceId))} (expected 200 and not listed)`);

          // The product refuses to deactivate a terminal that has an active device: deactivate the device, then the terminal, then enable the device again
          const toggle = async (route: string, isActive: boolean, label: string) => {
            const [response, body] = await this.securePUT<unknown, object>(route, { IsActive: isActive });
            expect(response.status(), `control (${label}): ${body.CodeError ?? 'no error code'}`).toBe(200);
          };
          await toggle(`/tenants/${tenantId}/devices/${deviceId}`, false, 'deactivate the device');
          await toggle(`/tenants/${tenantId}/terminals/${terminalId}`, false, 'deactivate the terminal');
          await toggle(`/tenants/${tenantId}/devices/${deviceId}`, true, 'enable the device again');

          const [after, afterBody] = await read();
          const alert = (afterBody.Data ?? []).find(item => item.Id === deviceId);
          verify(failures, after.status() === 200 && alert !== undefined && alert.MissingMac === true, `device on a deactivated terminal: HTTP ${after.status()}, listed ${String(alert !== undefined)}, MissingMac ${String(alert?.MissingMac)} (expected listed with MissingMac true)`);
        }
        finally {
          for (const route of children) {
            const [removed] = await this.secureDELETE<unknown>(route);
            if (![200, 400, 404].includes(removed.status())) {
              failures.push(`delete ${route}: HTTP ${removed.status()}`);
            }
          }
          failures.push(...await this.deleteTenants(tenantIds));
        }
      },
    });
  }

  /**
   * LOG-020: ATDP exports. The downloads list answers 200; an export with no client is refused (400), with a tenant that does not
   * exist (404), with an inverted range (400); a valid one answers 200 and creates a download in `Pendiente`. The PDF itself comes
   * from the ATDP worker: when it is down the answer is a controlled error, never a 500. Each run leaves one download record.
   */
  @atc('LOG-020')
  async requestAtdpExport(): Promise<void> {
    await this.runLogCase({
      what: 'ATDP export',
      body: async (failures) => {
        const tenantIds: number[] = [];
        try {
          const { rnec } = await this.createTenantFor(tenantIds);
          const [list, listBody] = await this.secureGET<PagedData<AtdpDownload>>('/logs/atdp/downloads');
          verify(failures, list.status() === 200 && listBody.Ok === true, `downloads: HTTP ${list.status()} ${listBody.CodeError ?? 'no error code'}`);

          const range = { StartDate: dateAway(-10), EndDate: dateAway(-1) };
          const rows = [
            { label: 'no client', body: { ClientId: '', ...range }, status: 400 },
            { label: 'tenant that does not exist', body: { ClientId: `NOEXISTE${this.data.createRnecOfLength(8)}`, ...range }, status: 404 },
            { label: 'inverted range', body: { ClientId: rnec, StartDate: range.EndDate, EndDate: range.StartDate }, status: 400 },
          ];
          for (const row of rows) {
            const [response, body] = await this.securePOST<unknown, object>('/logs/atdp/export', row.body);
            verify(failures, response.status() === row.status && body.Ok === false, `export, ${row.label}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'} (expected ${row.status})`);
          }

          const [valid, validBody] = await this.securePOST<unknown, object>('/logs/atdp/export', { ClientId: rnec, ...range });
          verify(failures, valid.status() === 200 && validBody.Ok === true, `export, valid: HTTP ${valid.status()} ${validBody.CodeError ?? 'no error code'} (expected 200)`);
          const [after, afterBody] = await this.secureGET<PagedData<AtdpDownload>>(`/logs/atdp/downloads?ClientId=${encodeURIComponent(rnec)}`);
          const requested = (afterBody.Data?.Data ?? []).filter(download => download.ClientId === rnec);
          verify(failures, after.status() === 200 && requested.length === 1 && requested[0].Status === 'Pendiente', `downloads of the tenant: HTTP ${after.status()}, ${requested.length} record(s), status ${requested[0]?.Status ?? 'none'} (expected one record in Pendiente)`);

          const [pdf, pdfBody] = await this.secureGET<unknown>(`/logs/atdp?clientId=${encodeURIComponent(rnec)}&nut=${this.data.createRnecOfLength(10)}`);
          verify(failures, pdf.status() < 500 || (pdf.status() === 503 && pdfBody.CodeError === 'ATDP_SERVICE_UNAVAILABLE'), `ATDP document: HTTP ${pdf.status()} ${pdfBody.CodeError ?? 'no error code'} (expected a result or a controlled 503 ATDP_SERVICE_UNAVAILABLE)`);
        }
        finally {
          failures.push(...await this.deleteTenants(tenantIds));
        }
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): log database down (needs the user to stop Mongo)
  // ============================================

  /**
   * Whether the log database looks down: a log query that has not answered 200 within 8 seconds. Opens its own Administrator session
   * and closes it. Used by the spec to skip LOG-013 while Mongo is up.
   */
  async isLogDatabaseDown(): Promise<boolean> {
    await this.openAdministratorSession();
    try {
      const pending = this.listLogs('consultas-nr', { pageSize: 1 }).then(([response]) => response.status()).catch(() => 0);
      const quick = await Promise.race([pending, new Promise<null>((resolve) => { setTimeout(() => { resolve(null); }, 8000); })]);
      return quick !== 200;
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }
  }

  /**
   * LOG-013: with Mongo stopped (by the user, before the run) a log query is answered in a controlled way: within 15 seconds and with
   * a code other than `INTERNAL_ERROR` (the product waits 41 s and answers 500, HAL-56), while the rest of the application stays up
   * (the tenant list answers 200 in under 3 seconds with the log query still pending).
   */
  @atc('LOG-013')
  async keepApplicationStableWithLogDatabaseDown(): Promise<void> {
    await this.runLogCase({
      what: 'log database down',
      body: async (failures) => {
        const started = Date.now();
        const logQuery = this.listLogs('consultas-nr', { pageSize: 1 }).then(([response, body]) => ({ status: response.status(), code: body.CodeError ?? null, took: Date.now() - started })).catch((error: unknown) => ({ status: 0, code: this.firstLine(error), took: Date.now() - started }));

        await new Promise<void>((resolve) => { setTimeout(resolve, 2000); });
        const probeStarted = Date.now();
        const [tenants] = await this.secureGET<unknown>('/Tenant?PageSize=1');
        const [operators] = await this.secureGET<unknown>('/operators?PageSize=1');
        const probeTook = Date.now() - probeStarted;
        verify(failures, tenants.status() === 200 && operators.status() === 200 && probeTook < 3000, `with the log query pending: tenants HTTP ${tenants.status()}, operators HTTP ${operators.status()}, ${probeTook} ms (expected 200, 200 and under 3000 ms)`);

        const result = await logQuery;
        verify(failures, result.took <= 15000, `the log query took ${result.took} ms to answer (expected 15000 ms or less)`);
        verify(failures, result.status !== 0 && result.code !== 'INTERNAL_ERROR', `the log query answered HTTP ${result.status} ${result.code ?? 'no error code'} (expected a controlled error such as 503, not INTERNAL_ERROR)`);
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): rows (seeded by LogSeedSteps)
  // ============================================

  /** Every row of a view for a filter, read in pages of 100 (the seeds never exceed that). */
  private async readAllRows(view: LogView, query: LogQuery, mine = false): Promise<{ status: number, total: number, rows: LogRow[] }> {
    const [response, body] = await this.listLogs(view, { ...query, pageSize: 100 }, mine);
    return { status: response.status(), total: body.Data?.TotalRecords ?? -1, rows: body.Data?.Data ?? [] };
  }

  /** The ids of rows, sorted, as text. */
  private idsOf(rows: Array<{ Id: string }>): string {
    return rows.map(row => row.Id).sort().join(',');
  }

  /** The seeded rows of the client in a view whose day (`YYYY-MM-DD`) is within the range, both ends included. */
  private seededWithin(docs: LogDoc[], start: string, end: string): LogDoc[] {
    return docs.filter((doc) => {
      const day = String(doc.OperationDate).slice(0, 10);
      return day >= start && day <= end;
    });
  }

  /** LOG-001: the rows of a client are listed per view: the total and the rows are the seeded ones, and only that client's. */
  @atc('LOG-001')
  async listLogsOfClient(args: { seed: LogSeed }): Promise<void> {
    const { seed } = args;
    await this.runLogCase({
      what: 'logs of a client',
      body: async (failures) => {
        for (const view of LOG_VIEWS) {
          for (const [label, clientId, expected] of [['client', seed.clientId, seed.own[view]], ['other client', seed.otherClientId, seed.other[view]]] as const) {
            const read = await this.readAllRows(view, { clientId });
            const foreign = read.rows.filter(row => row.ClientId !== clientId).length;
            verify(failures, read.status === 200 && read.total === expected.length && this.idsOf(read.rows) === this.idsOf(expected as Array<{ Id: string }>) && foreign === 0, `${view}, ${label}: HTTP ${read.status}, total ${read.total}, ${read.rows.length} rows, ${foreign} of another client (expected ${expected.length} rows of the client only)`);
          }
        }
      },
    });
  }

  /** LOG-004: the date range returns the rows inside it, both end days included, in the three views. */
  @atc('LOG-004')
  async filterLogsByDateRange(args: { seed: LogSeed }): Promise<void> {
    const { seed } = args;
    await this.runLogCase({
      what: 'log date range',
      body: async (failures) => {
        const ranges = [
          { label: 'all the seeded days', from: -40, to: -1 },
          { label: 'days 3 to 10 back', from: -10, to: -3 },
          { label: 'one day', from: -5, to: -5 },
          { label: 'days with no rows', from: -200, to: -100 },
        ];
        for (const view of LOG_VIEWS) {
          for (const range of ranges) {
            const start = dateAway(range.from);
            const end = dateAway(range.to);
            const expected = this.seededWithin(seed.own[view], start, end);
            const read = await this.readAllRows(view, { clientId: seed.clientId, startDate: start, endDate: end });
            verify(failures, read.status === 200 && read.total === expected.length && this.idsOf(read.rows) === this.idsOf(expected as Array<{ Id: string }>), `${view}, ${range.label}: HTTP ${read.status}, ${read.rows.length} rows (total ${read.total}), expected ${expected.length}`);
          }
        }
      },
    });
  }

  /** LOG-008: `ClientId`, `AplicantId` and `OperatorId` filter, and combined they work as AND (queries view). */
  @atc('LOG-008')
  async combineLogFilters(args: { seed: LogSeed }): Promise<void> {
    const { seed } = args;
    await this.runLogCase({
      what: 'log filters',
      body: async (failures) => {
        const own = seed.own['consultas-nr'];
        const combos: Array<{ label: string, query: LogQuery, operator?: string, applicant?: string }> = [
          { label: 'ClientId only', query: {} },
          { label: 'OperatorId', query: { operatorId: seed.operators.even }, operator: seed.operators.even },
          { label: 'AplicantId', query: { aplicantId: seed.applicants.multipleOfFour }, applicant: seed.applicants.multipleOfFour },
          { label: 'OperatorId and AplicantId', query: { operatorId: seed.operators.even, aplicantId: seed.applicants.multipleOfFour }, operator: seed.operators.even, applicant: seed.applicants.multipleOfFour },
          { label: 'OperatorId and AplicantId that never go together', query: { operatorId: seed.operators.odd, aplicantId: seed.applicants.multipleOfFour }, operator: seed.operators.odd, applicant: seed.applicants.multipleOfFour },
        ];
        for (const combo of combos) {
          const expected = own.filter(doc => (combo.operator === undefined || doc.OperatorId === combo.operator) && (combo.applicant === undefined || doc.AplicantId === combo.applicant));
          const read = await this.readAllRows('consultas-nr', { clientId: seed.clientId, ...combo.query });
          verify(failures, read.status === 200 && read.total === expected.length && this.idsOf(read.rows) === this.idsOf(expected as Array<{ Id: string }>), `${combo.label}: HTTP ${read.status}, ${read.rows.length} rows (total ${read.total}), expected ${expected.length}`);
        }
      },
    });
  }

  /**
   * LOG-010: paging is consistent. Pages of 10 over the 28 rows of the client hold 10, 10 and 8 rows with no repeats, newest first
   * across the pages; a page past the end is empty with the real total; the page size is capped at 10 000.
   */
  @atc('LOG-010')
  async pageLogsConsistently(args: { seed: LogSeed }): Promise<void> {
    const { seed } = args;
    await this.runLogCase({
      what: 'log paging',
      body: async (failures) => {
        const expected = seed.own['consultas-nr'];
        const seen: LogRow[] = [];
        for (const [page, size] of [[1, 10], [2, 10], [3, 8]]) {
          const [response, body] = await this.listLogs('consultas-nr', { clientId: seed.clientId, page, pageSize: 10 });
          const rows = body.Data?.Data ?? [];
          seen.push(...rows);
          verify(failures, response.status() === 200 && rows.length === size && body.Data?.TotalRecords === expected.length && body.Data.TotalPages === 3, `page ${page}: HTTP ${response.status()}, ${rows.length} rows, total ${String(body.Data?.TotalRecords)}, pages ${String(body.Data?.TotalPages)} (expected ${size} rows, ${expected.length}, 3)`);
        }
        verify(failures, new Set(seen.map(row => row.Id)).size === seen.length && this.idsOf(seen) === this.idsOf(expected as Array<{ Id: string }>), 'the three pages repeat a row or miss one');
        const dates = seen.map(row => String(row.OperationDate ?? ''));
        verify(failures, dates.every((date, index) => index === 0 || dates[index - 1] >= date), 'the rows are not ordered newest first across the pages');
        const [beyond, beyondBody] = await this.listLogs('consultas-nr', { clientId: seed.clientId, page: 4, pageSize: 10 });
        verify(failures, beyond.status() === 200 && (beyondBody.Data?.Data.length ?? 0) === 0 && beyondBody.Data?.TotalRecords === expected.length, `page 4: HTTP ${beyond.status()}, ${beyondBody.Data?.Data.length ?? 0} rows, total ${String(beyondBody.Data?.TotalRecords)} (expected an empty page with the real total)`);
        const [huge, hugeBody] = await this.listLogs('consultas-nr', { clientId: seed.clientId, pageSize: 100000 });
        verify(failures, huge.status() === 200 && (hugeBody.Data?.PageSize ?? 0) <= 10000, `page size 100000: HTTP ${huge.status()}, size ${String(hugeBody.Data?.PageSize)} (expected it capped at 10000)`);
      },
    });
  }

  /** LOG-014: a row whose optional fields are all null is returned with 200 and null fields (the screen can show them as empty). */
  @atc('LOG-014')
  async readLogsWithNullFields(args: { seed: LogSeed }): Promise<void> {
    const { seed } = args;
    await this.runLogCase({
      what: 'log rows with null fields',
      body: async (failures) => {
        for (const view of LOG_VIEWS) {
          const nullDoc = seed.own[view].at(-1)!;
          const read = await this.readAllRows(view, { clientId: seed.clientId });
          const row = read.rows.find(item => item.Id === nullDoc.Id) as Record<string, unknown> | undefined;
          verify(failures, read.status === 200 && row !== undefined, `${view}: HTTP ${read.status}, the row with null fields is ${row === undefined ? 'missing' : 'present'}`);
          if (row === undefined) {
            continue;
          }
          const optional = Object.keys(nullDoc).filter(key => !['Id', 'ClientId', 'OperationDate', 'SearchStatus'].includes(key) && key !== 'OpetarionDetails');
          // an empty list is how a null list reads back
          const filled = optional.filter(key => row[key] !== null && row[key] !== undefined && !(Array.isArray(row[key]) && (row[key] as unknown[]).length === 0));
          verify(failures, filled.length === 0, `${view}: ${filled.length} optional field(s) came back with a value (${filled.join(', ')}); expected null`);
        }
      },
    });
  }

  /** LOG-015: the fields of every row (fingers, status, format, location, scores) are the values that were stored. */
  @atc('LOG-015')
  async showStoredLogValues(args: { seed: LogSeed }): Promise<void> {
    const { seed } = args;
    await this.runLogCase({
      what: 'log field values',
      body: async (failures) => {
        const fields: Record<LogView, string[]> = {
          'consultas-nr': ['SearchStatus', 'RequestId', 'OperatorId', 'ClientId', 'AplicantId', 'IdFinger1', 'IdFinger2', 'FingerPrintFormat', 'StatusFinger1', 'StatusFinger2', 'ServerName', 'ServerIP', 'ServerMac', 'IdInscripcion'],
          'peticiones-nr': ['OperatorId', 'ClientId', 'AplicantId', 'FingersToGet', 'FingerPrintFormat', 'UserCod', 'UserIP', 'UserMac', 'DpMovil', 'GdLatitud', 'GdLongitud', 'CodigoSede', 'IdInscripcion'],
          'respuestas-no-satisfactorias-nr': ['OperatorId', 'ClientId', 'AplicantId', 'Score1', 'Score2', 'Minucia1', 'Minucia2', 'IdInscripcion'],
        };
        for (const view of LOG_VIEWS) {
          const read = await this.readAllRows(view, { clientId: seed.clientId });
          const byId = new Map(read.rows.map(row => [row.Id, row as unknown as Record<string, unknown>]));
          const different: string[] = [];
          for (const doc of seed.own[view]) {
            const row = byId.get(String(doc.Id));
            if (row === undefined) {
              different.push(`${String(doc.Id)} (missing)`);
              continue;
            }
            for (const field of fields[view]) {
              const normalize = (value: unknown) => (Array.isArray(value) && value.length === 0 ? null : (value ?? null));
              if (JSON.stringify(normalize(row[field])) !== JSON.stringify(normalize(doc[field]))) {
                different.push(`${String(doc.Id)}.${field}`);
              }
            }
            if (!String(row.OperationDate ?? '').startsWith(String(doc.OperationDate).slice(0, 10))) {
              different.push(`${String(doc.Id)}.OperationDate`);
            }
          }
          verify(failures, read.status === 200 && different.length === 0, `${view}: HTTP ${read.status}, ${different.length} value(s) differ from what was stored (${different.slice(0, 5).join(', ')})`);
        }
      },
    });
  }

  /**
   * LOG-017: a tenant user gets only what the screen needs. A GENERATED TenantAdmin reads its `mis-` views: exactly its own rows, none
   * of another client even when it sends that client's `ClientId`, and the unsatisfactory-responses view does not carry the
   * fingerprint minutiae (HAL-38: it returns `Minucia1` and `Minucia2` in the clear).
   */
  @atc('LOG-017')
  async exposeOnlyNeededLogData(args: { seed: LogSeed, username: string, readPassword: () => Promise<string> }): Promise<void> {
    const { seed } = args;
    await this.runLogCase({
      what: 'log data exposure',
      body: async (failures) => {
        const credentials = { userName: args.username, password: await args.readPassword() };
        await this.asTenantUser(credentials, async (probe) => {
          for (const view of LOG_VIEWS) {
            for (const asked of [undefined, seed.otherClientId]) {
              const read = await probe.readAllRows(view, asked === undefined ? {} : { clientId: asked }, true);
              const foreign = read.rows.filter(row => row.ClientId !== seed.clientId).length;
              verify(failures, read.status === 200 && read.total === seed.own[view].length && foreign === 0, `mis-${view}${asked === undefined ? '' : ' asking for another client'}: HTTP ${read.status}, total ${read.total}, ${foreign} row(s) of another client (expected ${seed.own[view].length} own rows only)`);
            }
          }
          const read = await probe.readAllRows('respuestas-no-satisfactorias-nr', {}, true);
          const exposed = read.rows.filter((row) => {
            const record = row as unknown as Record<string, unknown>;
            return record.Minucia1 !== undefined && record.Minucia1 !== null;
          }).length;
          verify(failures, exposed === 0, `mis-respuestas-no-satisfactorias-nr: ${exposed} row(s) carry the fingerprint minutiae (expected none)`);
        });
      },
    });
  }

  /**
   * UAP-013: a UserApp reads only the logs of its own tenant. A GENERATED UserApp of the tenant that owns the seeded rows reads the
   * `mis-` views: exactly the rows of its tenant, none of the other client even when it sends that client's `ClientId`, and the
   * Administrator views answer 403. The UserApp is deleted at the end.
   */
  @atc('UAP-013')
  async readOnlyOwnTenantLogsAsUserApp(args: { seed: LogSeed, tenantId: number }): Promise<void> {
    const { seed, tenantId } = args;
    await this.runLogCase({
      what: 'UserApp log isolation',
      body: async (failures) => {
        const userApp = this.data.createUserAppPayload();
        const [created, createdBody] = await this.securePOST<CreatedEntityData, object>(`/tenants/${tenantId}/appusers`, userApp);
        const userAppId = createdBody.Data?.Id ?? 0;
        try {
          expect(created.status(), `control (create UserApp): ${createdBody.CodeError ?? 'no error code'}`).toBe(200);
          await this.asTenantUser({ userName: String(userApp.UserName), password: String(userApp.Password) }, async (probe) => {
            for (const view of LOG_VIEWS) {
              for (const asked of [undefined, seed.otherClientId]) {
                const read = await probe.readAllRows(view, asked === undefined ? {} : { clientId: asked }, true);
                const foreign = read.rows.filter(row => row.ClientId !== seed.clientId).length;
                verify(failures, read.status === 200 && read.total === seed.own[view].length && foreign === 0, `mis-${view}${asked === undefined ? '' : ' asking for another client'}: HTTP ${read.status}, total ${read.total}, ${foreign} row(s) of another client (expected ${seed.own[view].length} own rows only)`);
              }
              const [refused, refusedBody] = await probe.listLogs(view);
              verify(failures, refused.status() === 403 && refusedBody.Ok === false, `Administrator view ${view}: HTTP ${refused.status()} (expected 403)`);
            }
          });
        }
        finally {
          if (userAppId > 0) {
            const [removed] = await this.secureDELETE<unknown>(`/tenants/${tenantId}/appusers/${userAppId}`);
            if (![200, 404].includes(removed.status())) {
              failures.push(`delete the generated UserApp: HTTP ${removed.status()}`);
            }
          }
        }
      },
    });
  }
}
