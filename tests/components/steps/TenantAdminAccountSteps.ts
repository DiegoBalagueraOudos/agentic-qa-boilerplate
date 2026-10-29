/**
 * KATA Architecture - Layer 3: Steps - TenantAdmin account lifecycle (ADM cases)
 *
 * Owns the generated state of the ADM specs: a tenant (and a second one on demand), the
 * ONE mailed TenantAdmin that the lifecycle ATCs share, its welcome-mail token, its
 * activation, and the cleanup. Undecorated and instantiated directly
 * (`new TenantAdminAccountSteps()`), not a fixture: like `GeneratedPrincipalsSteps` and
 * `MailedAccountSteps` it owns its OWN request context and Administrator login (one positive
 * login), so it works in `beforeAll` of an `e2e` spec that does not depend on `api-setup`.
 *
 * Mail rule: `prepareTenant`, `prepareSecondTenant`, `trackTenantAdmin`
 * and `cleanup` send NO mail. Only the ATC that creates (or resends for) a TenantAdmin
 * triggers one; this class reads it (`confirmWelcomeMail`, `confirmResentMail`) and shares the
 * 12 s mail-gap rule of `MailedAccountSteps` (`waitForMailSlot`, `markMailSent`).
 *
 * Secret handling: the activation tokens and the new password live in PRIVATE fields and are
 * exposed ONLY as thunks (`() => Promise<string>`), which print as `[Function]` in any step
 * title. Nothing here logs, attaches or throws a mail body, a token or a password; failures name
 * the check only. Each mail is deleted right after being read (and again by recipient in `cleanup`).
 *
 * Usage: `prepareTenant()` in `beforeAll`, `cleanup()` in `afterAll`. The Administrator
 * credentials come by name from `config.testUser`; the mailbox from `config.mailbox`.
 */

import type { MailMessage } from '@api/MailboxApi';
import type { APIRequestContext } from '@playwright/test';

import { AuthApi } from '@api/AuthApi';
import { MailboxApi } from '@api/MailboxApi';
import { TenantAdminsApi } from '@api/TenantAdminsApi';
import { TenantsApi } from '@api/TenantsApi';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { markMailTriggered, waitForMailGap } from '@steps/MailedAccountSteps';
import { TestContext } from '@TestContext';

/** A generated tenant: the id (route and API) and the business name (what the SPA shows). */
export interface GeneratedTenant {
  id: number
  name: string
}

/** The mailed account's secrets as thunks: they print as `[Function]`, never as a value. */
export interface TenantAdminSecrets {
  /** Token of the first (welcome) mail, kept to prove a resend invalidates it. */
  readFirstActivationToken: () => Promise<string>
  /** The password chosen at activation (generated, private; only readable after `activateAccount`). */
  readPassword: () => Promise<string>
}

export class TenantAdminAccountSteps extends TestContext {
  private context: APIRequestContext | null = null;
  private auth: AuthApi | null = null;
  private tenants: TenantsApi | null = null;
  private tenantAdmins: TenantAdminsApi | null = null;
  private readonly mailbox = new MailboxApi();

  private tenantId: number | null = null;
  private secondTenantId: number | null = null;
  private readonly tenantAdminIds = new Set<number>();
  private recipient: string | null = null;
  private adoptedFullName = '';
  /** Every address whose mails cleanup clears: the adopted account plus rows the product wrongly accepted. */
  private readonly mailRecipients = new Set<string>();

  /** Secrets. Private on purpose: only the thunks reach them. */
  private firstToken: string | null = null;
  private latestToken: string | null = null;
  private password: string | null = null;

  // ============================================
  // Helpers (Private)
  // ============================================

  /** Open the own context and the own Administrator session once (a positive login). */
  private async ensureSession(): Promise<{ tenants: TenantsApi, tenantAdmins: TenantAdminsApi }> {
    if (this.context && this.tenants && this.tenantAdmins) {
      return { tenants: this.tenants, tenantAdmins: this.tenantAdmins };
    }
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
    return { tenants, tenantAdmins };
  }

  private async createGeneratedTenant(): Promise<GeneratedTenant> {
    const { tenants } = await this.ensureSession();
    const payload = this.data.createTenantPayload();
    const [, body] = await tenants.createTenant(payload);
    return { id: body.Data!.Id, name: payload.BusinessName! };
  }

  /** Token: the 32-hex `token` query value of the activation link. Failure text carries no value. */
  private parseActivationToken(html: string): string {
    const token = /href="[^"]*[?&](?:amp;)?token=([0-9a-f]{32})"/i.exec(html)?.[1];
    if (!token) {
      throw new Error('activation mail: no activation link with a 32-hex token was found');
    }
    return token;
  }

  /** Wait for a mail to the recipient, return its token and delete the message. */
  private async readTokenFromNextMail(): Promise<string> {
    const recipient = this.recipient;
    if (recipient === null) {
      throw new Error('no TenantAdmin adopted: adopt the created account before waiting for its mail');
    }
    // The recipient is unique per account and every mail is deleted after being read, so any
    // message to it now is the awaited one (no time filter: it would add clock-skew risk)
    const message: MailMessage = await this.mailbox.waitForMessageTo(recipient);
    const html = await this.mailbox.readHtml(message);
    const token = this.parseActivationToken(html);
    await this.mailbox.deleteMessage(message);
    return token;
  }

  /** Record (count only) that accounts could not be deleted on their own and went with their tenant. */
  private annotateUndeletable(count: number): void {
    try {
      test.info().annotations.push({
        type: 'cleanup-note',
        description: `${count} tenant admin(s) refused a direct delete (last-admin rule) and were removed with their generated tenant`,
      });
    }
    catch {
      // outside a test or hook there is no annotation target
    }
  }

  private secretThunk(read: () => string | null, label: string): () => Promise<string> {
    return async () => {
      const value = read();
      if (value === null) {
        throw new Error(`${label} is not available yet`);
      }
      return value;
    };
  }

  // ============================================
  // Public helpers (no ATC)
  // ============================================

  /** Create the generated tenant (no mail). Opens the own Administrator session on first use. */
  async prepareTenant(): Promise<GeneratedTenant> {
    const tenant = await this.createGeneratedTenant();
    this.tenantId = tenant.id;
    return tenant;
  }

  /** Create a second generated tenant (ADM-003: the duplicate is attempted there). No mail. */
  async prepareSecondTenant(): Promise<GeneratedTenant> {
    const tenant = await this.createGeneratedTenant();
    this.secondTenantId = tenant.id;
    return tenant;
  }

  /**
   * Take over the TenantAdmin the ATC created, so `cleanup` always finds it (record the id as
   * soon as the create answers, BEFORE any further assertion). It becomes the account whose
   * mail and activation this class handles.
   */
  adoptTenantAdmin(account: { id: number, username: string, fullName?: string }): void {
    this.tenantAdminIds.add(account.id);
    this.adoptedFullName = account.fullName ?? '';
    this.recipient = account.username;
    this.mailRecipients.add(account.username);
  }

  /** Generated full name of the adopted account (the Administradores row shows it, not the e-mail). */
  get adoptedAdminFullName(): string {
    return this.adoptedFullName;
  }

  /**
   * Record an account that a rejected-input row created by mistake, so `cleanup` removes it and
   * clears its mail. It does NOT become the adopted account (no mail or token handling for it).
   */
  trackTenantAdmin(account: { id: number, username: string }): void {
    this.tenantAdminIds.add(account.id);
    this.mailRecipients.add(account.username);
  }

  /** Wait until the mail sandbox accepts another message. Call BEFORE the trigger that sends a mail. */
  async waitForMailSlot(): Promise<void> {
    await waitForMailGap();
  }

  /** Mark "a mail was just triggered". Call AFTER the trigger that sends a mail returns. */
  markMailSent(): void {
    markMailTriggered();
  }

  /** The account's secrets as thunks (see `TenantAdminSecrets`). */
  secrets(): TenantAdminSecrets {
    return {
      readFirstActivationToken: this.secretThunk(() => this.firstToken, 'first activation token'),
      readPassword: this.secretThunk(() => this.password, 'account password'),
    };
  }

  /** Wait for the welcome mail of the adopted account, keep its token and delete the mail. */
  async confirmWelcomeMail(): Promise<void> {
    const token = await this.readTokenFromNextMail();
    this.firstToken = token;
    this.latestToken = token;
  }

  /**
   * Wait for the mail a resend triggered. The new token must differ from the one before it
   * (the failure text carries no value) and becomes the latest token.
   */
  async confirmResentMail(): Promise<void> {
    markMailTriggered();
    const resent = await this.readTokenFromNextMail();
    if (resent === this.latestToken) {
      throw new Error('resent mail: the activation token is the same as the previous one');
    }
    this.latestToken = resent;
  }

  /**
   * Activate the adopted account with the latest token and a generated strong password kept
   * private (anonymous call, no mail). Fixed assertions: 200 and `Ok`; failure names status and code.
   */
  async activateAccount(): Promise<void> {
    const { tenantAdmins } = await this.ensureSession();
    const password = this.data.createActivationPassword();
    const result = await tenantAdmins.activateAccount(
      this.secretThunk(() => this.latestToken, 'activation token'),
      async () => password,
    );
    expect(result.status, `activate account: ${result.code ?? 'no error code'}`).toBe(200);
    expect(result.ok, 'activate account: the answer is not Ok').toBe(true);
    this.password = password;
  }

  /**
   * Keep a password the account now has (ADM-005 changed it), so the next ATCs sign in with the
   * CURRENT one. Private field, readable only through the `readPassword` thunk.
   */
  adoptPassword(newPassword: string): void {
    this.password = newPassword;
  }

  /**
   * Delete everything this instance created (mails to the recipient, the TenantAdmins, both
   * tenants), sign out and close the contexts. Every step is attempted; failures are reported
   * together at the end.
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

    const { tenantId, secondTenantId } = this;
    for (const recipient of this.mailRecipients) {
      await attempt('delete mails of a recipient', async () => this.mailbox.deleteAllFor(recipient));
    }
    // An account may already be gone (a row deleted it, or ADM-010 found the product allows deleting
    // the only admin: 404) or may be undeletable on its own (the only admin of a tenant, refused by
    // the product rule). Both are tolerated here; the account is then removed with its generated
    // tenant below, and only a failure of THAT delete is reported.
    const undeletable: number[] = [];
    if (tenantId !== null && this.tenantAdmins) {
      for (const id of this.tenantAdminIds) {
        await attempt(`delete tenantadmin #${id}`, async () => {
          const [response] = await this.tenantAdmins!.attemptDeleteTenantAdmin({ tenantId, tenantAdminId: id });
          const status = response.status();
          if (status === 404) {
            return;
          }
          if (status === 400 || status === 409) {
            undeletable.push(id);
            return;
          }
          if (status !== 200) {
            throw new Error(`HTTP ${status}`);
          }
        });
      }
    }
    for (const id of [tenantId, secondTenantId]) {
      if (id !== null && this.tenants) {
        await attempt(`delete tenant #${id}`, async () => this.tenants!.deleteTenant(id));
      }
    }
    if (undeletable.length > 0) {
      this.annotateUndeletable(undeletable.length);
    }
    if (this.auth) {
      await this.auth.logout().catch(() => undefined);
    }
    await this.mailbox.dispose();
    await this.context?.dispose().catch(() => undefined);

    this.tenantId = null;
    this.secondTenantId = null;
    this.tenantAdminIds.clear();
    this.recipient = null;
    this.mailRecipients.clear();
    this.firstToken = null;
    this.latestToken = null;
    this.password = null;
    this.context = null;
    this.auth = null;
    this.tenants = null;
    this.tenantAdmins = null;

    if (failures.length > 0) {
      throw new Error(`TenantAdmin account cleanup incomplete: ${failures.join('; ')}`);
    }
  }
}
