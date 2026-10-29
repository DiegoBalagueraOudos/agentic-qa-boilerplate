/**
 * KATA Architecture - Layer 3: Steps - Mailed account (welcome-mail cases)
 *
 * Creates a tenant and a PENDING TenantAdmin through the Administrator API,
 * waits for the welcome mail in the Mailtrap sandbox, reads the activation token
 * and the temporary password out of it, and removes everything afterwards.
 * Undecorated and instantiated directly (`new MailedAccountSteps()`), not a
 * fixture: it owns its OWN request context and Administrator login, like
 * `GeneratedPrincipalsSteps`, so it works in `beforeAll`.
 *
 * Secret handling: the token and the password are parsed inside PRIVATE helpers,
 * kept in private fields and exposed ONLY as thunks (`() => Promise<string>`).
 * A thunk prints as `[Function]` in any step title, so a decorated method that
 * receives one cannot leak the value. Nothing here logs, attaches or throws a
 * message body, a token or a password. Each mail is deleted right after being
 * read (and again by recipient in `cleanup`).
 *
 * Usage: `createPendingTenantAdmin()` in `beforeAll` (or inside a test, with a
 * `finally`), `cleanup()` in `afterAll`. The Administrator credentials come by
 * name from `config.testUser`; the mailbox from `config.mailbox`.
 */

import type { MailMessage } from '@api/MailboxApi';
import type { APIRequestContext } from '@playwright/test';

import fs from 'node:fs';
import path from 'node:path';
import { AuthApi } from '@api/AuthApi';
import { MailboxApi } from '@api/MailboxApi';
import { TenantAdminsApi } from '@api/TenantAdminsApi';
import { TenantsApi } from '@api/TenantsApi';

import { expect, request as playwrightRequest } from '@playwright/test';
import { TestContext } from '@TestContext';

/** The pending account: the login name is plain (generated), the secrets are thunks. */
export interface PendingTenantAdmin {
  username: string
  readActivationToken: () => Promise<string>
  readTemporaryPassword: () => Promise<string>
  /** Wait for the resent activation mail (after a resend request) and keep its token. */
  waitForResentMail: () => Promise<void>
  /** Token of the resent mail (valid only after `waitForResentMail`). */
  readResentActivationToken: () => Promise<string>
  /** Wait until the mail sandbox accepts another message (the mark is written once the resent mail is awaited). */
  waitForMailSlot: () => Promise<void>
}

/**
 * The mail sandbox silently drops a message sent a few seconds after another one (the
 * backend swallows the SMTP failure; observed: creation `Warning` or a resend that
 * never arrives). Every mail trigger of this suite waits until this gap has passed
 * since the previous one. The mark lives in a small file (a timestamp, no secret), not in
 * module state: Playwright restarts the worker after a failed test and module state would
 * be lost, so the next trigger would skip the wait.
 */
const MAIL_GAP_MS = 12_000;
const MAIL_MARK_FILE = path.join(process.cwd(), 'reports', '.last-mail-at');

/** Last trigger time, or undefined when the file is missing, empty, non-numeric, <= 0 or in the future. */
function readMailMark(): number | undefined {
  try {
    const value = Number(fs.readFileSync(MAIL_MARK_FILE, 'utf8').trim());
    return Number.isFinite(value) && value > 0 && value <= Date.now() ? value : undefined;
  }
  catch {
    return undefined;
  }
}

/** Mark "the last mail was triggered now": temp file then rename, so a reader never sees a partial value. */
function writeMailMark(at: number): void {
  fs.mkdirSync(path.dirname(MAIL_MARK_FILE), { recursive: true });
  const temp = `${MAIL_MARK_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, String(at));
  fs.renameSync(temp, MAIL_MARK_FILE);
}

/**
 * Wait until MAIL_GAP_MS has passed since the last mail trigger. Call it BEFORE the trigger;
 * call `markMailTriggered` AFTER the trigger returns. An unknown mark (missing, garbage,
 * future) applies the full gap.
 */
export async function waitForMailGap(): Promise<void> {
  const mark = readMailMark();
  const from = mark ?? Date.now();
  await expect.poll(() => Date.now() - from, { timeout: MAIL_GAP_MS + 5000, intervals: [500] })
    .toBeGreaterThanOrEqual(MAIL_GAP_MS);
}

export function markMailTriggered(): void {
  writeMailMark(Date.now());
}

/** HTML entities that can appear inside the parsed values. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

export class MailedAccountSteps extends TestContext {
  private context: APIRequestContext | null = null;
  private auth: AuthApi | null = null;
  private tenants: TenantsApi | null = null;
  private tenantAdmins: TenantAdminsApi | null = null;
  private readonly mailbox = new MailboxApi();

  private tenantId: number | null = null;
  private tenantAdminId: number | null = null;
  private recipient: string | null = null;

  /** Secrets read from the mail. Private on purpose: only the thunks reach them. */
  private activationToken: string | null = null;
  private temporaryPassword: string | null = null;
  private resentToken: string | null = null;

  // ============================================
  // Helpers (Private)
  // ============================================

  /** Token: the 32-hex `token` query value of the activation link. Failure text carries no value. */
  private parseActivationToken(html: string): string {
    const token = /href="[^"]*[?&](?:amp;)?token=([0-9a-f]{32})"/i.exec(html)?.[1];
    if (!token) {
      throw new Error('welcome mail: no activation link with a 32-hex token was found');
    }
    return token;
  }

  /** Temporary password: the 12 characters after `Contraseña temporal:`. Failure text carries no value. */
  private parseTemporaryPassword(html: string): string {
    const raw = /Contraseña temporal:<\/strong>\s*([^<\s]+)/.exec(html)?.[1];
    const password = raw === undefined ? undefined : decodeEntities(raw);
    if (password?.length !== 12) {
      throw new Error('welcome mail: the temporary password was not found as 12 characters');
    }
    return password;
  }

  /** Wait for a mail to the recipient, read its secrets into the private fields and delete it. */
  private async consumeWelcomeMail(recipient: string): Promise<void> {
    // The recipient is unique per account, so the exact address is the filter (no time filter:
    // it would only add Mailtrap-vs-local clock skew risk)
    const message: MailMessage = await this.mailbox.waitForMessageTo(recipient);
    const html = await this.mailbox.readHtml(message);
    this.activationToken = this.parseActivationToken(html);
    this.temporaryPassword = this.parseTemporaryPassword(html);
    await this.mailbox.deleteMessage(message);
  }

  /**
   * Wait for the resent mail, read its token into a private field and delete it. The
   * welcome mail was deleted after being read, so any message to the recipient now is
   * the resent one (no clock mark needed). The new token must differ from the first
   * one; the failure text carries no value.
   */
  private async consumeResentMail(): Promise<void> {
    const recipient = this.recipient;
    if (recipient === null) {
      throw new Error('no pending account: create it before waiting for a resent mail');
    }
    // The resend request has been answered by now: this is the moment the mail was triggered
    markMailTriggered();
    const message: MailMessage = await this.mailbox.waitForMessageTo(recipient);
    const html = await this.mailbox.readHtml(message);
    const resent = this.parseActivationToken(html);
    await this.mailbox.deleteMessage(message);
    if (resent === this.activationToken) {
      throw new Error('resent mail: the activation token is the same as the one in the first mail');
    }
    this.resentToken = resent;
  }

  private secretThunk(read: () => string | null, label: string): () => Promise<string> {
    return async () => {
      const value = read();
      if (value === null) {
        throw new Error(`${label} was not read from the mail yet`);
      }
      return value;
    };
  }

  // ============================================
  // Public helpers (no ATC)
  // ============================================

  /**
   * Open the own Administrator session, create a tenant and a pending TenantAdmin
   * with a unique generated recipient, and read its welcome mail. A partially
   * created state is rolled back before the failure is rethrown.
   */
  async createPendingTenantAdmin(): Promise<PendingTenantAdmin> {
    try {
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

      const [, tenantBody] = await tenants.createTenant(this.data.createTenantPayload());
      const tenantId = tenantBody.Data!.Id;
      this.tenantId = tenantId;

      const payload = this.data.createTenantAdminPayload();
      const recipient = payload.UserName!;
      this.recipient = recipient;

      await waitForMailGap();
      const [, adminBody] = await tenantAdmins.createTenantAdmin(tenantId, payload);
      markMailTriggered();
      // Record the id BEFORE any further assertion so rollback and cleanup always delete it
      this.tenantAdminId = adminBody.Data!.Id;
      expect(adminBody.Data?.MustChangePassword, 'a new TenantAdmin must change its password').toBe(true);
      expect(adminBody.Warning, 'the welcome mail could not be sent (SMTP or sandbox problem)').toBeFalsy();

      await this.consumeWelcomeMail(recipient);

      return {
        username: recipient,
        readActivationToken: this.secretThunk(() => this.activationToken, 'activation token'),
        readTemporaryPassword: this.secretThunk(() => this.temporaryPassword, 'temporary password'),
        waitForResentMail: async () => this.consumeResentMail(),
        waitForMailSlot: waitForMailGap,
        readResentActivationToken: this.secretThunk(() => this.resentToken, 'resent activation token'),
      };
    }
    catch (error) {
      const created = `tenant=${this.tenantId ?? 'none'}, tenantadmin=${this.tenantAdminId ?? 'none'}`;
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
   * Delete everything this instance created (mails to the recipient, TenantAdmin,
   * tenant), sign out and close the contexts. Every step is attempted; failures
   * are reported together at the end.
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

    const { tenantId, tenantAdminId, recipient } = this;
    if (recipient !== null) {
      await attempt('delete mails of the recipient', async () => this.mailbox.deleteAllFor(recipient));
    }
    if (tenantId !== null && tenantAdminId !== null && this.tenantAdmins) {
      await attempt(`delete tenantadmin #${tenantAdminId}`, async () => this.tenantAdmins!.deleteTenantAdmin(tenantId, tenantAdminId));
    }
    if (tenantId !== null && this.tenants) {
      await attempt(`delete tenant #${tenantId}`, async () => this.tenants!.deleteTenant(tenantId));
    }
    if (this.auth) {
      await this.auth.logout().catch(() => undefined);
    }
    await this.mailbox.dispose();
    await this.context?.dispose().catch(() => undefined);

    this.tenantId = null;
    this.tenantAdminId = null;
    this.recipient = null;
    this.activationToken = null;
    this.temporaryPassword = null;
    this.resentToken = null;
    this.context = null;
    this.auth = null;
    this.tenants = null;
    this.tenantAdmins = null;

    if (failures.length > 0) {
      throw new Error(`Mailed account cleanup incomplete: ${failures.join('; ')}`);
    }
  }
}
