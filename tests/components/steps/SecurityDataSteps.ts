/**
 * KATA Architecture - Layer 3: Steps - Security data (SEC cases)
 *
 * Prepares the data the SEC cases read: hostile-named operators (XSS and
 * injection text lives ONLY on generated operators, never on a tenant: the
 * backend whitelists tenant names), operators and tenants with audit fields set
 * by the Administrator, and a PUT that tries to forge `UpdatedBy`. Undecorated
 * and instantiated directly (`new SecurityDataSteps()`), not a fixture: it owns
 * its OWN request context, crypto session and Administrator login, like
 * `GeneratedPrincipalsSteps`, so it works in `beforeAll` of a spec that does not
 * depend on `api-setup`. The OPE cases add `createPlainOperator`, `createTenantUsingOperator`,
 * `trackOperator`, `readOperator`, `readTenantMainOperatorId` and `adoptOperatorIfCreated`.
 *
 * Usage: `open()` (or any create method, which opens lazily) in `beforeAll`,
 * `cleanup()` in `afterAll` and in a `finally`. Everything created carries the
 * `QAX<code>` name prefix or a generated RNEC, and `cleanup()` always tries to
 * delete it, reporting every failure together. The Administrator credentials
 * come by name from `config.testUser`. Nothing here logs a token, cookie or password.
 */

import type { TenantMainOperatorRead } from '@api/OperatorsApi';
import type { GeneratedOperator, HostilePayloadKind } from '@data/types';
import type { APIRequestContext } from '@playwright/test';
import type { CreateOperatorPayload, OperatorData } from '@schemas/security.types';

import { AuthApi } from '@api/AuthApi';
import { OperatorsApi } from '@api/OperatorsApi';
import { TenantsApi } from '@api/TenantsApi';
import { request as playwrightRequest } from '@playwright/test';
import { TestContext } from '@TestContext';

/** A generated tenant used by the audit cases. */
export interface AuditedTenant {
  id: number
  rnec: string
}

export class SecurityDataSteps extends TestContext {
  private context: APIRequestContext | null = null;
  private auth: AuthApi | null = null;
  private operators: OperatorsApi | null = null;
  private tenants: TenantsApi | null = null;

  /** Ids still alive on the server; removed from here once deleted. */
  private operatorIds = new Set<number>();
  private tenantIds = new Set<number>();

  /** Open the own context and Administrator session. Idempotent. */
  async open(): Promise<void> {
    if (this.context !== null) {
      return;
    }
    const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    this.context = context;
    const auth = new AuthApi({ request: context });
    const operators = new OperatorsApi({ request: context });
    const tenants = new TenantsApi({ request: context });
    this.auth = auth;
    this.operators = operators;
    this.tenants = tenants;

    try {
      const [, , session] = await auth.startAdminSession({
        UserName: this.config.testUser.email,
        Password: this.config.testUser.password,
      });
      operators.setCryptoSession(session);
      tenants.setCryptoSession(session);
    }
    catch (error) {
      await this.cleanup().catch(() => undefined);
      throw error;
    }
  }

  // ============================================
  // Operators
  // ============================================

  /** Create one operator whose name carries hostile text of the given kind (`QAX<code>` prefix). */
  async createHostileOperator(kind: HostilePayloadKind): Promise<GeneratedOperator> {
    return this.createOperator(this.data.createHostileOperatorPayload(kind), kind);
  }

  /** Create one operator and update it as the Administrator, so `CreatedBy` and `UpdatedBy` are set (SEC-011). */
  async createAuditedOperator(): Promise<GeneratedOperator> {
    const operator = await this.createOperator(this.data.createPlainOperatorPayload(), 'plain');
    const { operators } = this.require();
    const name = `QAX${operator.code} audited`;
    await operators.updateOperator(operator.id, { OperatorName: name });
    return { ...operator, name };
  }

  /**
   * Create one operator whose name carries quote and SQL characters (SEC-004 control).
   * The text matches none of the injection search terms, so the row is found by its
   * code only and must round-trip as literal text.
   */
  async createInjectionTextOperator(): Promise<GeneratedOperator> {
    const base = this.data.createPlainOperatorPayload();
    const payload = { ...base, OperatorName: `QAX${base.OperatorCode} O'Brien "quoted"; SELECT 1 --` };
    return this.createOperator(payload, 'plain');
  }

  /**
   * PUT an update whose body ALSO carries an `UpdatedBy` of a made-up address.
   * The backend ignores the field (`[JsonIgnore]`): the stored `UpdatedBy` must
   * still be the authenticated actor. Returns the operator as the PUT answered.
   */
  async updateOperatorWithForgedAuditField(operatorId: number): Promise<OperatorData> {
    const { operators } = this.require();
    const forged = { OperatorName: `QAX forged ${operatorId}`, UpdatedBy: `forged.${operatorId}@example.invalid` };
    const [, body] = await operators.updateOperator(operatorId, forged);
    return body.Data!;
  }

  /** Create one operator with a clean name (`QAX<code> plain`): OPE-001, 009, 011, 013 data. Cleaned by `cleanup()`. */
  async createPlainOperator(): Promise<GeneratedOperator> {
    return this.createOperator(this.data.createPlainOperatorPayload(), 'plain');
  }

  /**
   * Create a generated tenant whose main operator is `operatorId` (no TenantAdmin, so no mail; OPE-009).
   * Tracked for `cleanup()`. The tenant names stay clean: the backend whitelists them.
   */
  async createTenantUsingOperator(operatorId: number): Promise<AuditedTenant> {
    await this.open();
    const { tenants } = this.require();
    const payload = this.data.createTenantPayload({ MainOperatorId: operatorId });
    const [, created] = await tenants.createTenant(payload);
    const id = created.Data!.Id;
    this.tenantIds.add(id);
    return { id, rnec: payload.Rnec! };
  }

  /** Track an operator a case wrongly created (for example a refused role that was let through) so `cleanup()` removes it. */
  trackOperator(operatorId: number): void {
    this.operatorIds.add(operatorId);
  }

  /** A thunk that reads an operator's CURRENT state as the Administrator (null when it no longer exists). Reads when called. */
  readOperator(operatorId: number): () => Promise<OperatorData | null> {
    return async () => {
      await this.open();
      const { operators } = this.require();
      const [response, body] = await operators.getOperator(operatorId);
      return response.status() === 200 ? body.Data : null;
    };
  }

  /**
   * A thunk that reads the tenant's CURRENT `MainOperatorId` from the server. Reads when called.
   * `known: false` (with the status) when `GET /Tenant/{id}` was not 200: unknown is not "no operator".
   */
  readTenantMainOperatorId(tenantId: number): () => Promise<TenantMainOperatorRead> {
    return async () => {
      await this.open();
      const { tenants } = this.require();
      const [response, body] = await tenants.getTenant(tenantId);
      if (response.status() !== 200) {
        return { known: false, status: response.status() };
      }
      return { known: true, operatorId: body.Data?.MainOperatorId ?? null };
    };
  }

  /**
   * Take over an operator a spec created through the UI: look it up by its code and track it so
   * `cleanup()` removes it (OPE-012). Returns null ONLY when the search answered 200 and no live
   * operator has that code (the create never happened). Any other failure (session, 429, search
   * error) throws, so a leftover operator is never silent.
   */
  async adoptOperatorIfCreated(code: string): Promise<GeneratedOperator | null> {
    await this.open();
    const { operators } = this.require();
    const [response, body] = await operators.listOperators({ searchTerm: code, pageSize: 100 });
    if (response.status() !== 200) {
      throw new Error(`adoptOperatorIfCreated: the operator search answered HTTP ${response.status()}`);
    }
    const wanted = code.trim().toUpperCase();
    const found = body.Data?.Data.find(operator => operator.OperatorCode.toUpperCase() === wanted);
    if (found === undefined) {
      return null;
    }
    this.operatorIds.add(found.Id);
    return { id: found.Id, code: found.OperatorCode, name: found.OperatorName, kind: 'plain' };
  }

  // ============================================
  // Tenants (audit fields only; names stay clean: the backend whitelists them)
  // ============================================

  /** Create a tenant, update it, then soft-delete it, all as the Administrator (SEC-011). */
  async createAuditedTenant(): Promise<AuditedTenant> {
    const { tenants } = this.require();
    const payload = this.data.createTenantPayload();
    const [, created] = await tenants.createTenant(payload);
    const id = created.Data!.Id;
    this.tenantIds.add(id);

    await tenants.updateTenant(id, { BusinessName: `${payload.BusinessName} upd` });
    await tenants.deleteTenant(id);
    this.tenantIds.delete(id);
    return { id, rnec: payload.Rnec! };
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Delete everything this instance created still alive (operators, tenants),
   * sign out and close the context. Every step is attempted; failures are
   * reported together at the end so one stuck delete does not leave the rest behind.
   */
  async cleanup(): Promise<void> {
    const failures: string[] = [];
    const attempt = async (label: string, action: () => Promise<unknown>) => {
      try {
        await action();
      }
      catch (error) {
        failures.push(`${label}: ${(error as Error).message.split('\n')[0]}`);
      }
    };

    for (const id of [...this.tenantIds]) {
      if (this.tenants) {
        await attempt(`delete tenant #${id}`, async () => this.tenants!.deleteTenant(id));
      }
    }
    // Tenants first (a correct product refuses to delete an operator a tenant still uses), then operators.
    // Tolerant of an operator the case already deleted (404): the product may remove it on purpose
    if (this.operators && this.operatorIds.size > 0) {
      failures.push(...await this.operators.cleanupCreated([...this.operatorIds]));
    }
    if (this.auth) {
      await this.auth.logout().catch(() => undefined);
    }
    await this.context?.dispose().catch(() => undefined);

    this.operatorIds.clear();
    this.tenantIds.clear();
    this.context = null;
    this.auth = null;
    this.operators = null;
    this.tenants = null;

    if (failures.length > 0) {
      throw new Error(`Security data cleanup incomplete: ${failures.join('; ')}`);
    }
  }

  // ============================================
  // Private helpers
  // ============================================

  private async createOperator(
    payload: CreateOperatorPayload,
    kind: GeneratedOperator['kind'],
  ): Promise<GeneratedOperator> {
    await this.open();
    const { operators } = this.require();
    const [, body] = await operators.createOperator(payload);
    const id = body.Data!.Id;
    this.operatorIds.add(id);
    return { id, code: payload.OperatorCode!, name: payload.OperatorName!, kind };
  }

  private require(): { operators: OperatorsApi, tenants: TenantsApi } {
    if (this.operators === null || this.tenants === null) {
      throw new Error('SecurityDataSteps needs open() (or a create method) first');
    }
    return { operators: this.operators, tenants: this.tenants };
  }
}
