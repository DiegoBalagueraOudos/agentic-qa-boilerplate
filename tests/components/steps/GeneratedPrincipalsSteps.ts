/**
 * KATA Architecture - Layer 3: Steps - Generated principals (ADR-0019)
 *
 * Creates a tenant, a UserApp and a non-root platform Admin through the
 * Administrator API and removes them afterwards. Undecorated and instantiated
 * directly (`new GeneratedPrincipalsSteps()`), not a fixture: it owns its OWN
 * request context, crypto session and Administrator login, so it works in
 * `beforeAll` of an e2e spec that does not depend on `api-setup`.
 *
 * Usage: `create()` in `beforeAll`, `cleanup()` in `afterAll` (and in a `finally`
 * for a one-test flow). Passwords are generated; the Administrator credentials
 * come by name from `config.testUser`.
 */

import type { GeneratedPrincipals } from '@data/types';
import type { APIRequestContext } from '@playwright/test';

import { AuthApi } from '@api/AuthApi';
import { TenantsApi } from '@api/TenantsApi';
import { UserAppsApi } from '@api/UserAppsApi';
import { UsersApi } from '@api/UsersApi';
import { request as playwrightRequest } from '@playwright/test';
import { TestContext } from '@TestContext';

export class GeneratedPrincipalsSteps extends TestContext {
  private context: APIRequestContext | null = null;
  private auth: AuthApi | null = null;
  private tenants: TenantsApi | null = null;
  private users: UsersApi | null = null;
  private userApps: UserAppsApi | null = null;

  private tenantId: number | null = null;
  private userAppId: number | null = null;
  private adminId: number | null = null;
  /** Extra UserApps of the same tenant, created on demand; removed from here once deleted. */
  private extraUserAppIds = new Set<number>();

  /** Open the own session as Administrator, then create the three principals. */
  async create(): Promise<GeneratedPrincipals> {
    try {
      const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
      this.context = context;
      const auth = new AuthApi({ request: context });
      const tenants = new TenantsApi({ request: context });
      const users = new UsersApi({ request: context });
      const userApps = new UserAppsApi({ request: context });
      this.auth = auth;
      this.tenants = tenants;
      this.users = users;
      this.userApps = userApps;

      const [, , session] = await auth.startAdminSession({
        UserName: this.config.testUser.email,
        Password: this.config.testUser.password,
      });
      tenants.setCryptoSession(session);
      users.setCryptoSession(session);
      userApps.setCryptoSession(session);

      const tenantPayload = this.data.createTenantPayload();
      const [, tenantBody] = await tenants.createTenant(tenantPayload);
      const tenantId = tenantBody.Data!.Id;
      this.tenantId = tenantId;

      const userAppPayload = this.data.createUserAppPayload();
      const [, userAppBody] = await userApps.createUserApp(tenantId, userAppPayload);
      const userAppId = userAppBody.Data!.Id;
      this.userAppId = userAppId;

      const adminPayload = this.data.createAdminPayload();
      const [, adminBody] = await users.createAdmin(adminPayload);
      const adminId = adminBody.Data!.Id;
      this.adminId = adminId;

      return {
        tenant: { id: tenantId, rnec: tenantPayload.Rnec! },
        userApp: { id: userAppId, username: userAppPayload.UserName!, password: userAppPayload.Password! },
        admin: { id: adminId, username: adminPayload.UserName!, password: adminPayload.Password! },
      };
    }
    catch (error) {
      // Do not leak what was already created when a later step fails
      const created = `tenant=${this.tenantId ?? 'none'}, userapp=${this.userAppId ?? 'none'}, admin=${this.adminId ?? 'none'}`;
      try {
        await this.cleanup();
      }
      catch (cleanupError) {
        // Keep the original failure and say what may be left behind (ids only, no secrets)
        const note = `rollback cleanup failed (${created}): ${(cleanupError as Error).message.split('\n')[0]}`;
        if (error instanceof Error) {
          error.message = `${error.message}\n${note}`;
          throw error;
        }
        throw new Error(`${String(error)}\n${note}`);
      }
      throw error;
    }
  }

  /**
   * Create one more UserApp in the generated tenant (for cases that deactivate
   * or delete an account). Cleanup removes it unless the case already did.
   */
  async createExtraUserApp(): Promise<GeneratedPrincipals['userApp']> {
    const { tenantId, userApps } = this;
    if (tenantId === null || !userApps) {
      throw new Error('createExtraUserApp needs create() first');
    }
    const payload = this.data.createUserAppPayload();
    const [, body] = await userApps.createUserApp(tenantId, payload);
    const id = body.Data!.Id;
    this.extraUserAppIds.add(id);
    return { id, username: payload.UserName!, password: payload.Password! };
  }

  /** Read the global platform-Admin failed-login threshold with the own Administrator session. */
  async readAdminLockoutThreshold(): Promise<number> {
    if (!this.users) {
      throw new Error('readAdminLockoutThreshold needs create() first');
    }
    const [, body] = await this.users.getAdminLockoutThreshold();
    return body.Data!.MaxFailedLoginAttempts;
  }

  /** Deactivate a UserApp created by this instance. */
  async deactivateUserApp(userAppId: number): Promise<void> {
    const { tenantId, userApps } = this;
    if (tenantId === null || !userApps) {
      throw new Error('deactivateUserApp needs create() first');
    }
    await userApps.setUserAppActive({ tenantId, userAppId, isActive: false });
  }

  /** Soft-delete a UserApp created by this instance; cleanup will not try it again. */
  async deleteUserApp(userAppId: number): Promise<void> {
    const { tenantId, userApps } = this;
    if (tenantId === null || !userApps) {
      throw new Error('deleteUserApp needs create() first');
    }
    await userApps.deleteUserApp(tenantId, userAppId);
    this.extraUserAppIds.delete(userAppId);
  }

  /**
   * Delete everything this instance created (UserApp, Admin, tenant), sign out
   * and close the context. Every step is attempted; failures are reported
   * together at the end so one stuck delete does not leave the rest behind.
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

    const { tenantId, userAppId, adminId } = this;
    for (const extraId of this.extraUserAppIds) {
      if (tenantId !== null && this.userApps) {
        await attempt(`delete extra userapp #${extraId}`, async () => this.userApps!.deleteUserApp(tenantId, extraId));
      }
    }
    if (tenantId !== null && userAppId !== null && this.userApps) {
      await attempt(`delete userapp #${userAppId}`, async () => this.userApps!.deleteUserApp(tenantId, userAppId));
    }
    if (adminId !== null && this.users) {
      await attempt(`delete admin #${adminId}`, async () => this.users!.deleteAdmin(adminId));
    }
    if (tenantId !== null && this.tenants) {
      await attempt(`delete tenant #${tenantId}`, async () => this.tenants!.deleteTenant(tenantId));
    }
    if (this.auth) {
      await this.auth.logout().catch(() => undefined);
    }
    await this.context?.dispose().catch(() => undefined);

    this.tenantId = null;
    this.userAppId = null;
    this.adminId = null;
    this.extraUserAppIds.clear();
    this.context = null;
    this.auth = null;
    this.tenants = null;
    this.users = null;
    this.userApps = null;

    if (failures.length > 0) {
      throw new Error(`Generated principals cleanup incomplete: ${failures.join('; ')}`);
    }
  }
}
