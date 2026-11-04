/**
 * KATA Architecture - Layer 3: Steps - tenant with children (TEN-041)
 *
 * Owns the generated state of the "delete a tenant that has children" case: a tenant with a branch, a UserApp and
 * a pending TenantAdmin, and the cleanup. Undecorated and instantiated directly (`new TenantChildrenSteps()`), not a
 * fixture: it owns its OWN request context and Administrator login (one positive login).
 *
 * Mail rule: only `prepareTenantWithChildren` sends a mail (the TenantAdmin welcome mail, 1 message in the sandbox). It
 * waits for the sandbox gap before the trigger, marks it after, and `cleanup` deletes the mails to that recipient.
 * The mail is NOT read: nothing here needs the token or the temporary password, and nothing logs a secret.
 *
 * Usage: `prepareTenantWithChildren()` in `beforeAll`, `cleanup()` in `afterAll`. Cleanup order: user app, tenant admin, branch,
 * tenant (a children delete that answers 404 or `TENANT_INACTIVE` is tolerated: the tenant may have been deleted by the case).
 */

import type { APIRequestContext } from '@playwright/test';

import { AuthApi } from '@api/AuthApi';
import { BranchesApi } from '@api/BranchesApi';
import { MailboxApi } from '@api/MailboxApi';
import { TenantAdminsApi } from '@api/TenantAdminsApi';
import { TenantsApi } from '@api/TenantsApi';
import { UserAppsApi } from '@api/UserAppsApi';
import { request as playwrightRequest } from '@playwright/test';
import { markMailTriggered, waitForMailGap } from '@steps/MailedAccountSteps';
import { TestContext } from '@TestContext';

/** The tenant and its children. */
export interface TenantWithChildren {
  tenantId: number
  branchId: number
  userAppId: number
  tenantAdminId: number
}

interface OwnApis {
  auth: AuthApi
  tenants: TenantsApi
  branches: BranchesApi
  userApps: UserAppsApi
  tenantAdmins: TenantAdminsApi
}

export class TenantChildrenSteps extends TestContext {
  private context: APIRequestContext | null = null;
  private apis: OwnApis | null = null;
  private readonly mailbox = new MailboxApi();

  private created: TenantWithChildren | null = null;
  private tenantOnly: number | null = null;
  private recipient: string | null = null;

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
    const userApps = new UserAppsApi({ request: context });
    const tenantAdmins = new TenantAdminsApi({ request: context });

    const [, , session] = await auth.startAdminSession({
      UserName: this.config.testUser.email,
      Password: this.config.testUser.password,
    });
    for (const api of [tenants, branches, userApps, tenantAdmins]) {
      api.setCryptoSession(session);
    }

    this.apis = { auth, tenants, branches, userApps, tenantAdmins };
    return this.apis;
  }

  /** Create a tenant with a branch, a UserApp and a pending TenantAdmin (one welcome mail). Ids are recorded as each one is created. */
  async prepareTenantWithChildren(): Promise<TenantWithChildren> {
    const { tenants, branches, userApps, tenantAdmins } = await this.ensureSession();
    const [, tenantBody] = await tenants.createTenant(this.data.createTenantPayload());
    const tenantId = tenantBody.Data!.Id;
    this.tenantOnly = tenantId;

    const [, branchBody] = await branches.createBranch(tenantId, this.data.createBranchPayload());
    const [, userAppBody] = await userApps.createUserApp(tenantId, this.data.createUserAppPayload());

    const adminPayload = this.data.createTenantAdminPayload();
    this.recipient = adminPayload.UserName ?? null;
    await waitForMailGap();
    const [, adminBody] = await tenantAdmins.createTenantAdmin(tenantId, adminPayload);
    markMailTriggered();

    this.created = {
      tenantId,
      branchId: branchBody.Data!.Id,
      userAppId: userAppBody.Data!.Id,
      tenantAdminId: adminBody.Data!.Id,
    };
    return this.created;
  }

  /** Delete what exists, children first; every step is attempted and the failures are reported together. */
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
    // A child that is gone (404), refused because its tenant is inactive or protected (400/403/409) is not a cleanup failure by itself.
    const tolerate = (status: number) => {
      if (![200, 400, 403, 404, 409].includes(status)) {
        throw new Error(`HTTP ${status}`);
      }
    };

    const apis = this.apis;
    const children = this.created;
    if (apis && children) {
      await attempt(`delete userapp #${children.userAppId}`, async () => {
        const [response] = await apis.userApps.attemptDeleteUserApp(children.tenantId, children.userAppId);
        tolerate(response.status());
      });
      await attempt(`delete tenantadmin #${children.tenantAdminId}`, async () => {
        const [response] = await apis.tenantAdmins.attemptDeleteTenantAdmin({ tenantId: children.tenantId, tenantAdminId: children.tenantAdminId });
        tolerate(response.status());
      });
      await attempt(`delete branch #${children.branchId}`, async () => {
        const [response] = await apis.branches.attemptDeleteBranch(children.tenantId, children.branchId);
        tolerate(response.status());
      });
    }
    const tenantId = children?.tenantId ?? this.tenantOnly;
    if (apis && tenantId !== null) {
      await attempt(`delete tenant #${tenantId}`, async () => {
        const [response] = await apis.tenants.attemptDeleteTenant(tenantId);
        tolerate(response.status());
      });
    }
    if (this.recipient !== null) {
      const recipient = this.recipient;
      await attempt('delete the mails of the generated recipient', async () => this.mailbox.deleteAllFor(recipient));
    }
    await attempt('log out', async () => apis?.auth.logout());
    await this.context?.dispose().catch(() => undefined);
    await this.mailbox.dispose().catch(() => undefined);

    this.context = null;
    this.apis = null;
    this.created = null;
    this.tenantOnly = null;
    this.recipient = null;

    if (failures.length > 0) {
      throw new Error(`Tenant children cleanup incomplete: ${failures.join('; ')}`);
    }
  }
}
