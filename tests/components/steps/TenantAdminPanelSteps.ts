/**
 * KATA Architecture - Layer 3: Steps - activated TenantAdmin of a generated tenant (TEN-091, TEN-092)
 *
 * Owns the generated state of the "TenantAdmin panel" cases: a tenant, ONE TenantAdmin created for it (one welcome mail in the
 * sandbox), its activation with a generated password, and the cleanup. Undecorated and instantiated directly
 * (`new TenantAdminPanelSteps()`), not a fixture: it owns its OWN request context and Administrator login (one positive login).
 * The cases that edit the tenant from the TenantAdmin side work on THIS tenant, never on the suite's real TenantAdmin account.
 *
 * Mail rule: only `prepareActivatedTenantAdmin` sends a mail. It waits for the sandbox gap before the trigger, marks it after,
 * reads the activation token (never printed) and deletes the message; `cleanup` deletes the mails to the recipient again.
 *
 * Secret handling: the generated password lives in a PRIVATE field and leaves only as a thunk, which prints as `[Function]`.
 *
 * Usage: `prepareActivatedTenantAdmin()` inside the ATC, `cleanup()` in its `finally`.
 */

import type { MailMessage } from '@api/MailboxApi';
import type { APIRequestContext } from '@playwright/test';

import { AuthApi } from '@api/AuthApi';
import { MailboxApi } from '@api/MailboxApi';
import { TenantAdminsApi } from '@api/TenantAdminsApi';
import { TenantsApi } from '@api/TenantsApi';
import { expect, request as playwrightRequest } from '@playwright/test';
import { markMailTriggered, waitForMailGap } from '@steps/MailedAccountSteps';
import { TestContext } from '@TestContext';

/** The activated account: ids and login name are plain (generated), the password is a thunk. */
export interface ActivatedTenantAdmin {
  tenantId: number
  rnec: string
  tenantAdminId: number
  username: string
  readPassword: () => Promise<string>
}

export class TenantAdminPanelSteps extends TestContext {
  private context: APIRequestContext | null = null;
  private auth: AuthApi | null = null;
  private tenants: TenantsApi | null = null;
  private tenantAdmins: TenantAdminsApi | null = null;
  private readonly mailbox = new MailboxApi();

  private tenantId: number | null = null;
  private tenantAdminId: number | null = null;
  private recipient: string | null = null;
  private password: string | null = null;

  /** Token: the 32-hex `token` query value of the activation link. Failure text carries no value. */
  private parseActivationToken(html: string): string {
    const token = /href="[^"]*[?&](?:amp;)?token=([0-9a-f]{32})"/i.exec(html)?.[1];
    if (!token) {
      throw new Error('welcome mail: no activation link with a 32-hex token was found');
    }
    return token;
  }

  /** Create the tenant and its TenantAdmin, read the welcome mail and activate the account. Ids are recorded as they are created. */
  async prepareActivatedTenantAdmin(): Promise<ActivatedTenantAdmin> {
    const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    this.context = context;
    const auth = new AuthApi({ request: context });
    const tenants = new TenantsApi({ request: context });
    const tenantAdmins = new TenantAdminsApi({ request: context });
    this.auth = auth;
    this.tenants = tenants;
    this.tenantAdmins = tenantAdmins;

    const [, , session] = await auth.startAdminSession({
      UserName: this.config.testUser.email,
      Password: this.config.testUser.password,
    });
    tenants.setCryptoSession(session);
    tenantAdmins.setCryptoSession(session);

    const tenantPayload = this.data.createTenantPayload();
    const [, tenantBody] = await tenants.createTenant(tenantPayload);
    const tenantId = tenantBody.Data!.Id;
    this.tenantId = tenantId;

    const payload = this.data.createTenantAdminPayload();
    const recipient = payload.UserName!;
    this.recipient = recipient;
    await waitForMailGap();
    const [, adminBody] = await tenantAdmins.createTenantAdmin(tenantId, payload);
    markMailTriggered();
    this.tenantAdminId = adminBody.Data!.Id;
    expect(adminBody.Warning, `the welcome mail could not be sent (SMTP or sandbox problem): ${String(adminBody.Warning)}`).toBeFalsy();

    const message: MailMessage = await this.mailbox.waitForMessageTo(recipient);
    const token = this.parseActivationToken(await this.mailbox.readHtml(message));
    await this.mailbox.deleteMessage(message);

    const password = this.data.createActivationPassword();
    const result = await tenantAdmins.activateAccount(async () => token, async () => password);
    expect(result.status, `activate account: ${result.code ?? 'no error code'}`).toBe(200);
    this.password = password;

    return {
      tenantId,
      rnec: String(tenantPayload.Rnec),
      tenantAdminId: this.tenantAdminId,
      username: recipient,
      readPassword: async () => {
        if (this.password === null) {
          throw new Error('account password is not available');
        }
        return this.password;
      },
    };
  }

  /** Delete the mails, the TenantAdmin and the tenant, sign out and close the context. Every step is attempted; failures are reported together. */
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
    const { tenantId, tenantAdminId, recipient } = this;
    if (recipient !== null) {
      await attempt('delete mails of the recipient', async () => this.mailbox.deleteAllFor(recipient));
    }
    if (tenantId !== null && tenantAdminId !== null && this.tenantAdmins) {
      await attempt(`delete tenantadmin #${tenantAdminId}`, async () => {
        const [response] = await this.tenantAdmins!.attemptDeleteTenantAdmin({ tenantId, tenantAdminId });
        // the only admin of a tenant may be refused (400 or 409): it goes with its tenant below
        if (![200, 400, 404, 409].includes(response.status())) {
          throw new Error(`HTTP ${response.status()}`);
        }
      });
    }
    if (tenantId !== null && this.tenants) {
      await attempt(`delete tenant #${tenantId}`, async () => {
        const [response] = await this.tenants!.attemptDeleteTenant(tenantId);
        if (![200, 400, 404].includes(response.status())) {
          throw new Error(`HTTP ${response.status()}`);
        }
      });
    }
    await attempt('log out', async () => this.auth?.logout());
    await this.mailbox.dispose().catch(() => undefined);
    await this.context?.dispose().catch(() => undefined);

    this.context = null;
    this.auth = null;
    this.tenants = null;
    this.tenantAdmins = null;
    this.tenantId = null;
    this.tenantAdminId = null;
    this.recipient = null;
    this.password = null;

    if (failures.length > 0) {
      throw new Error(`TenantAdmin panel cleanup incomplete: ${failures.join('; ')}`);
    }
  }
}
