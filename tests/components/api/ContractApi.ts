/**
 * KATA Architecture - Layer 3: Contract API Component (INT cases)
 *
 * What the API does against its own published contract (`api/openapi.json`) and when a message broker it depends on is down.
 * Helpers named `attempt*` and `list*` assert nothing.
 *
 * - INT-006: every read endpoint of the contract an Administrator can call with the data this case prepares answers 200 with the
 *   envelope `{Ok, Data, CodeError, Error}` the contract describes.
 * - INT-007: with RabbitMQ stopped (by the USER) an ATDP export request is answered in a controlled way and leaves no download
 *   that can never be processed.
 *
 * Secret handling: nothing here prints a body; failures name the route, the status and the error code only.
 */

import type { CreatedEntityData } from '@schemas/auth.types';
import type { TenantFullData } from '@schemas/resources.types';
import type { PagedData } from '@schemas/security.types';

import fs from 'node:fs';
import path from 'node:path';
import { SecureApi } from '@api/SecureApi';
import { expect } from '@playwright/test';
import { atc } from '@utils/decorators';

/** Routes the contract lists that this case cannot call as an Administrator with the data it prepares, and why. */
const SKIPPED_ROUTES: Record<string, string> = {
  '/api/logs/atdp': 'needs the client id and the NUT of a real request and the ATDP worker',
  '/api/logs/atdp/mine': 'tenant user route',
  '/api/logs/mis-consultas-nr': 'tenant user route',
  '/api/logs/mis-peticiones-nr': 'tenant user route',
  '/api/logs/mis-respuestas-no-satisfactorias-nr': 'tenant user route',
  '/api/Tenant/my-tenant': 'TenantAdmin route',
  '/api/Synchronize/inforuserapp': 'needs the tenant API client token',
  '/api/Synchronize/infobranch': 'needs the tenant API client token',
  '/api/Synchronize/infoterminal': 'needs the tenant API client token',
  '/api/User/email/{email}': 'needs an existing e-mail the case does not hold',
  '/api/tenants/{tenantId}/tenant-admins/events': 'server-sent events stream: it never ends',
};

/** One path of the contract with the GET operation. */
interface ContractRoute {
  route: string
  required: string[]
}

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

export class ContractApi extends SecureApi {
  /** The GET routes of the contract with the names of their required parameters. */
  private readRoutes(): ContractRoute[] {
    const contract = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'api', 'openapi.json'), 'utf8')) as { paths: Record<string, { get?: { parameters?: Array<{ name: string, required?: boolean }> } }> };
    return Object.entries(contract.paths)
      .filter(([, item]) => item.get !== undefined)
      .map(([route, item]) => ({ route, required: (item.get?.parameters ?? []).filter(parameter => parameter.required === true).map(parameter => parameter.name) }));
  }

  /** First line of an error, for a failure list (no stack, no call log, never a credential). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /**
   * INT-006: every GET route of the contract that an Administrator can call with a generated tenant, operator and the Administrator
   * itself answers 200 with `Ok` true and a `Data` field. A route the case cannot call is listed with its reason in `SKIPPED_ROUTES`;
   * one that needs the id of a child resource it does not prepare (a branch, a terminal...) is not called either.
   *
   * @param args - The generated tenant the routes are called with
   * @param args.tenantId - Tenant id
   */
  @atc('INT-006')
  async answerEveryReadRouteAsTheContractSays(args: { tenantId: number }): Promise<void> {
    const failures: string[] = [];
    const login = await this.openAdministratorSession();
    const operatorPayload = this.data.createPlainOperatorPayload();
    const [, operatorBody] = await this.securePOST<CreatedEntityData, typeof operatorPayload>('/operators', operatorPayload);
    const operatorId = operatorBody.Data?.Id ?? 0;
    try {
      const [, tenant] = await this.secureGET<TenantFullData>(`/Tenant/${args.tenantId}`);
      const values: Record<string, string> = {
        tenantId: String(args.tenantId),
        rnec: String(tenant.Data?.Rnec ?? ''),
        id: '',
      };
      const idByRoute = (route: string): string => {
        if (route.startsWith('/api/Tenant/')) { return String(args.tenantId); }
        if (route.startsWith('/api/operators/')) { return String(operatorId); }
        if (route.startsWith('/api/User/')) { return String(login.Data?.UserId ?? 0); }
        return '';
      };
      let called = 0;
      for (const { route, required } of this.readRoutes()) {
        if (SKIPPED_ROUTES[route] !== undefined) { continue; }
        const needsId = required.includes('id');
        if (needsId && idByRoute(route) === '') { continue; }
        const filled = route.replace('{tenantId}', values.tenantId).replace('{rnec}', values.rnec).replace('{id}', idByRoute(route));
        if (filled.includes('{')) { continue; }
        called++;
        try {
          const [response, body] = await this.secureGET<unknown>(filled.replace(/^\/api/, ''));
          verify(failures, response.status() === 200 && body.Ok === true && body.Data !== undefined, `${route}: HTTP ${response.status()} Ok=${String(body.Ok)} ${body.CodeError ?? 'no error code'} (expected 200 with the envelope)`);
        }
        catch (error) {
          failures.push(`${route}: no answer (${this.firstLine(error)})`);
        }
      }
      expect(called, 'control: the contract gave routes to call').toBeGreaterThan(10);
    }
    finally {
      if (operatorId > 0) {
        await this.secureDELETE<unknown>(`/operators/${operatorId}`).catch(() => undefined);
      }
      await this.postLogout().catch(() => undefined);
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} contract route checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * INT-007: with RabbitMQ stopped (the USER stops `validate-rabbitmq` before the run), `POST /logs/atdp/export` for a valid tenant is
   * answered in a controlled way (a 200, or a 4xx or 503 with an error code, never a 500) and it leaves no download in `Pendiente`
   * when it did not succeed: a download that no worker will ever process (HAL-55).
   *
   * @param args - The generated tenant the export is requested for
   * @param args.rnec - RNEC of the tenant (the client id of the export)
   */
  @atc('INT-007')
  async keepExportRequestControlledWhenBrokerIsDown(args: { rnec: string }): Promise<void> {
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      const range = { StartDate: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10), EndDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) };
      const started = Date.now();
      const [response, body] = await this.securePOST<unknown, object>('/logs/atdp/export', { ClientId: args.rnec, ...range });
      const took = Date.now() - started;
      const status = response.status();
      verify(failures, status === 200 || ((status === 503 || (status >= 400 && status < 500)) && (body.CodeError ?? '') !== ''), `export with the broker down: HTTP ${status} ${body.CodeError ?? 'no error code'} after ${took} ms (expected 200, or a controlled 4xx/503 with an error code; never a 500)`);
      const [, list] = await this.secureGET<PagedData<{ ClientId: string, Status: string }>>(`/logs/atdp/downloads?ClientId=${encodeURIComponent(args.rnec)}`);
      const pending = (list.Data?.Data ?? []).filter(download => download.ClientId === args.rnec && download.Status === 'Pendiente').length;
      verify(failures, status === 200 || pending === 0, `${pending} download(s) left in Pendiente although the request answered HTTP ${status}: nothing will ever process them`);
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} broker-down checks failed. ${failures.join('; ')}`);
    }
  }
}
