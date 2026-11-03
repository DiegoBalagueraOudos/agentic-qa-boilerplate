/**
 * KATA Architecture - Layer 3: Steps - branch data for the SUC cases
 *
 * Owns the generated state of the SUC specs: a tenant, the branches and terminals created
 * under it, and the cleanup. Undecorated and instantiated directly (`new BranchDataSteps()`),
 * not a fixture: like `TenantAdminAccountSteps` it owns its OWN request context and
 * Administrator login (one positive login), so it works in `beforeAll` of a spec.
 *
 * No mail is sent here: a tenant, a branch and a terminal create no TenantAdmin.
 *
 * Usage: `prepareTenant()` in `beforeAll`, `cleanup()` in `afterAll`. The Administrator
 * credentials come by name from `config.testUser`. Cleanup order: terminals, branches, tenants
 * (a branch with an active terminal cannot be deleted).
 */

import type { APIRequestContext } from '@playwright/test';
import type { BranchData, CreateBranchPayload } from '@schemas/resources.types';

import { AuthApi } from '@api/AuthApi';
import { BranchesApi } from '@api/BranchesApi';
import { DevicesApi } from '@api/DevicesApi';
import { TenantsApi } from '@api/TenantsApi';
import { TerminalsApi } from '@api/TerminalsApi';
import { request as playwrightRequest } from '@playwright/test';
import { TestContext } from '@TestContext';

/** A generated branch: the id (route and API) plus the code and name that were sent. */
export interface GeneratedBranch {
  id: number
  code: string
  name: string
}

/** A generated terminal: the id plus the terminal name and the branch code and name (what lists and CSV files show). */
export interface GeneratedTerminal {
  id: number
  name: string
  branchCode: string
  branchName: string
}

interface OwnApis {
  auth: AuthApi
  tenants: TenantsApi
  branches: BranchesApi
  terminals: TerminalsApi
  devices: DevicesApi
}

export class BranchDataSteps extends TestContext {
  private context: APIRequestContext | null = null;
  private apis: OwnApis | null = null;

  private readonly tenantIds: number[] = [];
  /** `tenantId:branchId` pairs, so cleanup can delete a branch under its own tenant. */
  private readonly branchRefs: Array<{ tenantId: number, branchId: number }> = [];
  private readonly terminalRefs: Array<{ tenantId: number, terminalId: number }> = [];
  private readonly deviceRefs: Array<{ tenantId: number, deviceId: number }> = [];

  // ============================================
  // Helpers (Private)
  // ============================================

  /** Open the own context and the own Administrator session once (a positive login). */
  private async ensureSession(): Promise<OwnApis> {
    if (this.apis) {
      return this.apis;
    }
    const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    this.context = context;
    const auth = new AuthApi({ request: context });
    const tenants = new TenantsApi({ request: context });
    const branches = new BranchesApi({ request: context });
    const terminals = new TerminalsApi({ request: context });
    const devices = new DevicesApi({ request: context });

    const [, , session] = await auth.startAdminSession({
      UserName: this.config.testUser.email,
      Password: this.config.testUser.password,
    });
    tenants.setCryptoSession(session);
    branches.setCryptoSession(session);
    terminals.setCryptoSession(session);
    devices.setCryptoSession(session);

    this.apis = { auth, tenants, branches, terminals, devices };
    return this.apis;
  }

  // ============================================
  // Setup
  // ============================================

  /** Create a generated tenant and track it for cleanup. Returns its id. */
  async prepareTenant(): Promise<number> {
    const { tenants } = await this.ensureSession();
    const [, body] = await tenants.createTenant(this.data.createTenantPayload());
    const tenantId = body.Data!.Id;
    this.tenantIds.push(tenantId);
    return tenantId;
  }

  /** Create a generated branch under the tenant (all fields valid unless overridden) and track it. */
  async prepareBranch(tenantId: number, overrides: Partial<CreateBranchPayload> = {}): Promise<GeneratedBranch> {
    const { branches } = await this.ensureSession();
    const payload = { ...this.data.createBranchPayload(), ...overrides };
    const [, body] = await branches.createBranch(tenantId, payload);
    const branchId = body.Data!.Id;
    this.branchRefs.push({ tenantId, branchId });
    return { id: branchId, code: payload.BranchCode, name: payload.BranchName };
  }

  /** Create a generated branch and deactivate it (a branch without terminals deactivates), tracked for cleanup. */
  async prepareInactiveBranch(tenantId: number): Promise<GeneratedBranch> {
    const { branches } = await this.ensureSession();
    const branch = await this.prepareBranch(tenantId);
    const [response, body] = await branches.attemptUpdateBranch(tenantId, branch.id, { IsActive: false });
    if (response.status() !== 200 || body.Ok !== true) {
      throw new Error(`could not deactivate the generated branch: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
    }
    return branch;
  }

  /** Create a generated terminal under the branch and track it. Returns the terminal id. */
  async prepareTerminal(tenantId: number, branchId: number): Promise<number> {
    const { terminals } = await this.ensureSession();
    const [, body] = await terminals.createTerminal(tenantId, this.data.createTerminalPayload(branchId));
    const terminalId = body.Data!.Id;
    this.terminalRefs.push({ tenantId, terminalId });
    return terminalId;
  }

  /** Create a generated terminal under the branch and return it with the names the DIS cases look for. */
  async prepareNamedTerminal(tenantId: number, branch: GeneratedBranch): Promise<GeneratedTerminal> {
    const { terminals } = await this.ensureSession();
    const payload = this.data.createTerminalPayload(branch.id);
    const [, body] = await terminals.createTerminal(tenantId, payload);
    const terminalId = body.Data!.Id;
    this.terminalRefs.push({ tenantId, terminalId });
    return { id: terminalId, name: payload.TerminalName, branchCode: branch.code, branchName: branch.name };
  }

  /** Create a generated terminal and deactivate it (a terminal without devices deactivates), tracked for cleanup. */
  async prepareInactiveTerminal(tenantId: number, branchId: number): Promise<number> {
    const { terminals } = await this.ensureSession();
    const terminalId = await this.prepareTerminal(tenantId, branchId);
    await terminals.setTerminalActive(tenantId, terminalId, false);
    return terminalId;
  }

  /** Create a generated device on the terminal and track it. Returns the device id. */
  async prepareDevice(tenantId: number, terminalId: number): Promise<number> {
    const { devices } = await this.ensureSession();
    const [, body] = await devices.createDevice(tenantId, this.data.createDevicePayload(terminalId));
    const deviceId = body.Data!.Id;
    this.deviceRefs.push({ tenantId, deviceId });
    return deviceId;
  }

  /** Deactivate a device through the own session (a data move, not an ATC). */
  async deactivateDevice(tenantId: number, deviceId: number): Promise<void> {
    const { devices } = await this.ensureSession();
    await devices.setDeviceActive(tenantId, deviceId, false);
  }

  /** Read a device through the own session: the status and, when it answers 200, its state (a data read, not an ATC). */
  async readDevice(tenantId: number, deviceId: number): Promise<{ status: number, isActive: boolean | null }> {
    const { devices } = await this.ensureSession();
    const [response, body] = await devices.getDevice(tenantId, deviceId);
    return { status: response.status(), isActive: body.Data?.IsActive ?? null };
  }

  /** Delete a branch through the own session (a data move, not an ATC); it must answer 200. */
  async deleteBranch(tenantId: number, branchId: number): Promise<void> {
    const { branches } = await this.ensureSession();
    const [response, body] = await branches.attemptDeleteBranch(tenantId, branchId);
    if (response.status() !== 200 || body.Ok !== true) {
      throw new Error(`could not delete the generated branch: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
    }
  }

  /** Track a terminal created by an ATC (or wrongly accepted by the product) so cleanup removes it. */
  trackTerminal(tenantId: number, terminalId: number): void {
    this.terminalRefs.push({ tenantId, terminalId });
  }

  /** Track a branch created by an ATC (or wrongly accepted by the product) so cleanup removes it. */
  trackBranch(tenantId: number, branchId: number): void {
    this.branchRefs.push({ tenantId, branchId });
  }

  /** Deactivate a terminal through the own session (a data move, not an ATC). */
  async deactivateTerminal(tenantId: number, terminalId: number): Promise<void> {
    const { terminals } = await this.ensureSession();
    await terminals.setTerminalActive(tenantId, terminalId, false);
  }

  /** Read a branch through the own Administrator session; null when it is not found (a data read, not an ATC). */
  async readBranch(tenantId: number, branchId: number): Promise<BranchData | null> {
    const { branches } = await this.ensureSession();
    const [response, body] = await branches.getBranch(tenantId, branchId);
    return response.status() === 200 ? (body.Data ?? null) : null;
  }

  /** Read a terminal through the own session: the status and, when it answers 200, its state (a data read, not an ATC). */
  async readTerminal(tenantId: number, terminalId: number): Promise<{ status: number, isActive: boolean | null, branchId: number | null }> {
    const { terminals } = await this.ensureSession();
    const [response, body] = await terminals.getTerminal(tenantId, terminalId);
    return { status: response.status(), isActive: body.Data?.IsActive ?? null, branchId: body.Data?.BranchId ?? null };
  }

  // ============================================
  // Cleanup
  // ============================================

  /** Delete terminals, branches and tenants (tolerating rows already gone); throws one aggregated error. */
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
    const tolerate = (status: number) => {
      if (status !== 200 && status !== 404) {
        throw new Error(`HTTP ${status}`);
      }
    };

    const apis = this.apis;
    if (apis) {
      for (const { tenantId, deviceId } of this.deviceRefs) {
        await attempt(`delete device #${deviceId}`, async () => {
          const [response] = await apis.devices.attemptDeleteDevice(tenantId, deviceId);
          tolerate(response.status());
        });
      }
      for (const { tenantId, terminalId } of this.terminalRefs) {
        await attempt(`delete terminal #${terminalId}`, async () => {
          const [response] = await apis.terminals.attemptDeleteTerminal(tenantId, terminalId);
          if (response.status() === 500) {
            // The product answers 500 when the branch was already deleted (SUC-010) although it removes the terminal:
            // judge by a read, not by the status.
            const [readResponse] = await apis.terminals.getTerminal(tenantId, terminalId);
            tolerate(readResponse.status() === 404 ? 404 : 500);
            return;
          }
          tolerate(response.status());
        });
      }
      for (const { tenantId, branchId } of this.branchRefs) {
        await attempt(`delete branch #${branchId}`, async () => {
          const [response] = await apis.branches.attemptDeleteBranch(tenantId, branchId);
          tolerate(response.status());
        });
      }
      for (const id of this.tenantIds) {
        await attempt(`delete tenant #${id}`, async () => apis.tenants.deleteTenant(id));
      }
      await apis.auth.logout().catch(() => undefined);
    }
    await this.context?.dispose().catch(() => undefined);

    this.tenantIds.length = 0;
    this.branchRefs.length = 0;
    this.terminalRefs.length = 0;
    this.deviceRefs.length = 0;
    this.context = null;
    this.apis = null;

    if (failures.length > 0) {
      throw new Error(`Branch data cleanup incomplete: ${failures.join('; ')}`);
    }
  }
}
