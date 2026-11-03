/**
 * KATA Architecture - Data Factory
 *
 * Central generator of test data.
 * Golden rule: NEVER static data, always dynamic with Faker.
 *
 * Access:
 *   - From components: this.data.createCredentials()
 *   - Direct import: import { DataFactory } from '@DataFactory'
 */

import type {
  HostilePayloadKind,
  InputRow,
  OperatorLimitField,
  TenantAdminFieldLengths,
  TestCredentials,
  WeakPasswordRow,
} from '@data/types';
import type {
  CreateAdminPayload,
  CreateTenantAdminPayload,
  CreateTenantPayload,
  CreateUserAppPayload,
} from '@schemas/auth.types';
import type { CreateBranchPayload, CreateDevicePayload, CreateTerminalPayload } from '@schemas/resources.types';
import type { CreateOperatorPayload } from '@schemas/security.types';

import { faker } from '@faker-js/faker';

export class DataFactory {
  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private static testEmail(prefix = 'test'): string {
    const id = faker.string.alphanumeric(6).toLowerCase();
    const name = faker.person.firstName().toLowerCase();
    return `${prefix}.${name}.${id}@example.com`;
  }

  private static securePassword(): string {
    return `Test${faker.string.alphanumeric(8)}!`;
  }

  // ============================================
  // MAIN GENERATORS
  // ============================================

  /**
   * Generates credentials only (email + password)
   * @param overrides - Properties to override
   */
  static createCredentials(overrides?: Partial<TestCredentials>): TestCredentials {
    return {
      email: this.testEmail(),
      password: this.securePassword(),
      ...overrides,
    };
  }

  /**
   * Generates a fake activation token (it does not exist in the backend)
   */
  static createFakeActivationToken(): string {
    return faker.string.alphanumeric({ length: 43, casing: 'mixed' });
  }

  /**
   * Generates a JWT with an invalid signature (AUT-045). It is built locally:
   * header and payload in base64url with invented claims and a random signature,
   * so no real token is read or reused. It is secret-shaped: it never goes to a
   * step title, annotation or log.
   */
  static createTamperedJwt(): string {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const payload = encode({ sub: '0', role: 'Admin', exp: Math.floor(Date.now() / 1000) + 3600 });
    const signature = Buffer.from(faker.string.alphanumeric(43)).toString('base64url');
    return `${header}.${payload}.${signature}`;
  }

  /**
   * Generates a password that meets the activation rule
   * (minimum 8, upper case, lower case and a digit)
   */
  static createActivationPassword(): string {
    return `Aa1${faker.string.alphanumeric(8)}`;
  }

  /**
   * Tenant payload, unique per run (ADR-0019). The database coordinates are
   * invented: the backend does not check connectivity on create.
   * `MaxFailedLoginAttempts` is explicit so it does not depend on the global threshold.
   */
  static createTenantPayload(overrides?: Partial<CreateTenantPayload>): CreateTenantPayload {
    const id = faker.string.alphanumeric({ length: 10, casing: 'lower' });
    return {
      Rnec: `QA${id.toUpperCase()}`,
      BusinessName: `QA Auto ${id}`,
      DbHost: 'db.qa-aut.invalid',
      DbName: `qa_aut_${id}`,
      DbUser: 'qa_aut_user',
      DbPassword: this.createActivationPassword(),
      MaxFailedLoginAttempts: 3,
      ...overrides,
    };
  }

  /** UserApp payload (the username is global and at most 40 characters) */
  static createUserAppPayload(overrides?: Partial<CreateUserAppPayload>): CreateUserAppPayload {
    const id = faker.string.alphanumeric({ length: 10, casing: 'lower' });
    return {
      UserName: `qa.ua.${id}@example.com`,
      Password: this.createActivationPassword(),
      FullName: `QA UserApp ${id}`,
      ...overrides,
    };
  }

  /** Non-root platform Admin payload (the username must be a corporate email) */
  static createAdminPayload(overrides?: Partial<CreateAdminPayload>): CreateAdminPayload {
    const id = faker.string.alphanumeric({ length: 10, casing: 'lower' });
    return {
      UserName: `qa.adm.${id}@example.com`,
      Password: this.createActivationPassword(),
      FullName: `QA Admin ${id}`,
      ...overrides,
    };
  }

  /**
   * TenantAdmin payload for the welcome-mail cases. The recipient is unique per
   * call (the suite finds its mail by exact address); `example.com` passes the
   * corporate-domain rule. The password is NOT part of it: the backend generates it.
   */
  static createTenantAdminPayload(overrides?: Partial<CreateTenantAdminPayload>): CreateTenantAdminPayload {
    const id = faker.string.alphanumeric({ length: 10, casing: 'lower' });
    return {
      UserName: `qa.mail.${id}@example.com`,
      FullName: `QA Mailed ${id}`,
      Position: 'QA Administrator',
      ...overrides,
    };
  }

  /**
   * User names that are not a valid e-mail (ADM-002): each must be refused by the format rule.
   * The last row is a well-formed address of 256 characters (the limit is 255). Local parts start with `QAX`.
   */
  static createInvalidAdminEmails(): InputRow[] {
    const id = faker.string.alphanumeric({ length: 8, casing: 'lower' });
    const domain = '@example.com';
    const long = `qax${id}${'a'.repeat(256 - domain.length - 3 - id.length)}${domain}`;
    return [
      { label: 'no at sign', value: `qax-${id}` },
      { label: 'no dot in the domain', value: `qax.${id}@nodot` },
      { label: 'single-letter domain', value: 'a@b' },
      { label: 'empty local part', value: `@${id}.example.com` },
      { label: 'space inside', value: `qax ${id}@example.com` },
      { label: 'double at sign', value: `qax.${id}@@example.com` },
      { label: '256 characters', value: long },
    ];
  }

  /** Personal-domain e-mails the backend blocks (ADM-002), including upper-case variants. Local parts start with `QAX`. */
  static createPersonalDomainEmails(): InputRow[] {
    const id = faker.string.alphanumeric({ length: 8, casing: 'lower' });
    const domains = [
      'gmail.com',
      'hotmail.com',
      'yahoo.com',
      'outlook.com',
      'live.com',
      'icloud.com',
      'yahoo.es',
      'outlook.es',
      'GMAIL.COM',
      'Outlook.Com',
    ];
    return domains.map(domain => ({ label: domain.toLowerCase(), value: `qax.${id}@${domain}` }));
  }

  /** `FullName` of 256 and `Position` of 101 characters, both starting with `QAX` (ADM-004): one over each limit. */
  static createOversizedAdminFields(): TenantAdminFieldLengths {
    return { fullName: `QAX${'n'.repeat(253)}`, position: `QAX${'p'.repeat(98)}` };
  }

  /** `FullName` of 255 and `Position` of 100 characters: exactly the allowed limit, as edit data (ADM-005). */
  static createMaxLengthAdminFields(): TenantAdminFieldLengths {
    return { fullName: `QAX${'n'.repeat(252)}`, position: `QAX${'p'.repeat(97)}` };
  }

  /**
   * Passwords that each break ONE named rule of the TenantAdmin password (minimum 8, upper case,
   * lower case, digit; ADM-006). Random letters, so no value is reused. Secret-shaped: the value
   * never goes to a step title, annotation or error; the failure message names the rule.
   */
  static createWeakPasswords(): WeakPasswordRow[] {
    const upper = (length: number) => faker.string.alpha({ length, casing: 'upper' });
    const lower = (length: number) => faker.string.alpha({ length, casing: 'lower' });
    const digits = (length: number) => faker.string.numeric(length);
    return [
      { rule: 'min-length', value: `Aa1${lower(4)}` },
      { rule: 'uppercase', value: `${lower(6)}${digits(3)}` },
      { rule: 'lowercase', value: `${upper(6)}${digits(3)}` },
      { rule: 'digit', value: `A${lower(8)}` },
      { rule: 'empty', value: '' },
    ];
  }

  /** Unique operator code: `Q` + 8 upper-case alphanumerics (9 chars; the backend stores codes upper case, max 10). */
  static createOperatorCode(): string {
    return `Q${faker.string.alphanumeric({ length: 8, casing: 'upper' })}`;
  }

  /** Operator payload with a clean name (`QAX<code> plain`), for audit cases. */
  static createPlainOperatorPayload(overrides?: Partial<CreateOperatorPayload>): CreateOperatorPayload {
    const code = this.createOperatorCode();
    return {
      OperatorCode: code,
      OperatorName: `QAX${code} plain`,
      ServiceUrl: `https://qa-sec.invalid/${code.toLowerCase()}`,
      ...overrides,
    };
  }

  /**
   * Unique operator code of EXACTLY `length` characters: `QAX` + upper-case alphanumerics
   * (OPE cases; `length` below 3 gives a plain alphanumeric code of that length).
   * Valid characters only: invalid characters are added by `createInvalidOperatorCodes`.
   */
  static createOperatorCodeOfLength(length: number): string {
    const prefix = length >= 3 ? 'QAX' : '';
    return `${prefix}${faker.string.alphanumeric({ length: length - prefix.length, casing: 'upper' })}`;
  }

  /**
   * Operator codes the backend must refuse (OPE-003): each row is one broken rule. Limits come from
   * `ValidationConstants.Operator` (1 to 10) and `Patterns.OperatorCode` (`^[a-zA-Z0-9]+$`).
   * Valid-looking rows start with `QAX`. The LAST row is a valid code plus a trailing line break, the one
   * the .NET `$` anchor is predicted to let through (an unverified prediction, kept last on purpose).
   */
  static createInvalidOperatorCodes(): InputRow[] {
    const body = this.createOperatorCodeOfLength(6);
    return [
      { label: 'empty', value: '' },
      { label: 'whitespace only', value: '   ' },
      { label: '11 characters', value: this.createOperatorCodeOfLength(11) },
      { label: 'space inside', value: `${body.slice(0, 4)} ${body.slice(4)}` },
      { label: 'hyphen', value: `${body}-1` },
      { label: 'underscore', value: `${body}_1` },
      { label: 'dot', value: `${body}.1` },
      { label: 'at sign', value: `${body}@1` },
      { label: 'accented letter', value: `${body}\u00E9` },
      { label: 'trailing line break', value: `${this.createOperatorCodeOfLength(9)}\n` },
    ];
  }

  /**
   * Operator names the backend must refuse (OPE-005): empty, whitespace only and one over the limit of
   * 150 (`ValidationConstants.Operator.OperatorNameMax`). The long one starts with `QAX`.
   */
  static createOperatorNameRows(): InputRow[] {
    return [
      { label: 'empty', value: '' },
      { label: 'whitespace only', value: '   ' },
      { label: '151 characters', value: `QAX${'n'.repeat(148)}` },
    ];
  }

  /**
   * Service URLs the backend must refuse (OPE-006): empty, one over the limit of 500, free text, no
   * scheme, `ftp://` and `http://` with no host (rule `^https?://.+`). The LAST two rows are
   * malformed but prefix-valid (`https:// `, `http://a b c`): the owner asked for them as the final rows.
   */
  static createInvalidServiceUrls(): InputRow[] {
    const id = this.createOperatorCodeOfLength(8).toLowerCase();
    const prefix = 'https://qax.invalid/';
    return [
      { label: 'empty', value: '' },
      { label: '501 characters', value: `${prefix}${'u'.repeat(501 - prefix.length)}` },
      { label: 'free text', value: `qax service ${id}` },
      { label: 'no scheme', value: `qax.invalid/${id}` },
      { label: 'ftp scheme', value: `ftp://qax.invalid/${id}` },
      { label: 'http without host', value: 'http://' },
      { label: 'prefix with a space as host', value: 'https:// ' },
      { label: 'prefix with spaces inside', value: 'http://a b c' },
    ];
  }

  /**
   * A valid operator payload whose `field` sits exactly at its limit (OPE-003/005/006 positive controls):
   * code 10, name 150, service URL 500 characters. The `QAX` prefix and the `.invalid` host are kept.
   */
  static createMaxLengthOperatorPayload(field: OperatorLimitField): CreateOperatorPayload {
    const base = this.createPlainOperatorPayload();
    switch (field) {
      case 'code':
        return { ...base, OperatorCode: this.createOperatorCodeOfLength(10) };
      case 'name': {
        const head = `QAX${base.OperatorCode} `;
        return { ...base, OperatorName: `${head}${'n'.repeat(150 - head.length)}` };
      }
      case 'url': {
        const head = `https://qax.invalid/${base.OperatorCode!.toLowerCase()}/`;
        return { ...base, ServiceUrl: `${head}${'u'.repeat(500 - head.length)}` };
      }
    }
  }

  /**
   * Hostile operator payload (SEC cases). The name starts with `QAX<code>` so the
   * row is findable by the operator search and a leftover is easy to spot; the
   * hostile text follows. Operators are the only free-text entity the backend does
   * not whitelist. `ServiceUrl` is a reserved `.invalid` placeholder.
   */
  static createHostileOperatorPayload(kind: HostilePayloadKind, overrides?: Partial<CreateOperatorPayload>): CreateOperatorPayload {
    const hostile: Record<HostilePayloadKind, string> = {
      'img-onerror': '<img src=x onerror="window.__xss=1">',
      'script': '<script>window.__xss=2</script>',
      'svg-onload': '<svg onload="window.__xss=3">',
      'attribute-break': '"><img src=x onerror="window.__xss=4">',
    };
    const code = this.createOperatorCode();
    return {
      OperatorCode: code,
      OperatorName: `QAX${code} ${hostile[kind]}`,
      ServiceUrl: `https://qa-sec.invalid/${code.toLowerCase()}`,
      ...overrides,
    };
  }

  /** Hostile search terms for the injection checks (SEC-004): SQL, NoSQL-looking and wildcard text. */
  static createInjectionTerms(): string[] {
    return [
      '\' OR \'1\'=\'1',
      '\'; DROP TABLE "Tenant";--',
      '{"$ne":null}',
      '$ne',
      '%',
      '_',
      '.*',
      '" || 1==1',
    ];
  }

  /** Email that does not exist in the system */
  static createUnknownEmail(): string {
    return this.testEmail('unknown');
  }

  /** Valid-looking but wrong password for any generated account */
  static createWrongPassword(): string {
    return this.createActivationPassword();
  }

  // ============================================
  // BRANCHES (SUC cases)
  // ============================================

  /** A department the backend accepts (`ValidationConstants.Branch.ColombianDepartments`); the validator's own example. */
  static readonly validDepartment = 'Cundinamarca';

  /** Unique branch code of EXACTLY `length` characters: `QAX` + upper-case alphanumerics. */
  static createBranchCodeOfLength(length: number): string {
    return `QAX${faker.string.alphanumeric({ length: Math.max(length - 3, 0), casing: 'upper' })}`.slice(0, Math.max(length, 3));
  }

  /** Unique branch name of EXACTLY `length` characters, `QAX` first (so cleanup and searches recognise it). */
  static createBranchNameOfLength(length: number): string {
    return `QAX${faker.string.alpha({ length: Math.max(length - 3, 0), casing: 'lower' })}`.slice(0, Math.max(length, 3));
  }

  /** Address of EXACTLY `length` characters (the backend adds no pattern, only a maximum). */
  static createAddressOfLength(length: number): string {
    return faker.string.alpha({ length, casing: 'lower' });
  }

  /** A valid branch: unique code and name, a short address and a valid department. */
  static createBranchPayload(overrides?: Partial<CreateBranchPayload>): CreateBranchPayload {
    const code = this.createBranchCodeOfLength(10);
    return {
      BranchCode: code,
      BranchName: `QAX Sede ${code.slice(3)}`,
      Address: `Calle ${faker.number.int({ min: 1, max: 99 })} # ${faker.number.int({ min: 1, max: 99 })}-${faker.number.int({ min: 1, max: 99 })}`,
      Department: this.validDepartment,
      ...overrides,
    };
  }

  /**
   * A valid terminal for `branchId`: unique `QAX` name and a unique MAC (six hex octets with colons,
   * `ValidationConstants.Terminal.MacPattern`). A MAC is global to the tenant, so it is always generated.
   */
  static createTerminalPayload(branchId: number, overrides?: Partial<CreateTerminalPayload>): CreateTerminalPayload {
    return {
      BranchId: branchId,
      TerminalName: `QAX Terminal ${faker.string.alphanumeric({ length: 6, casing: 'upper' })}`,
      Mac: faker.internet.mac(':').toUpperCase(),
      DeviceType: 'FIJO',
      ...overrides,
    };
  }

  /**
   * Branch codes the backend must refuse (SUC-003, the case's own rule: empty or longer than 50):
   * empty, whitespace only and 51 characters. The documented boundary (a 50-character code is ACCEPTED)
   * is built by the ATC with `createBranchCodeOfLength(50)`.
   */
  static createInvalidBranchCodes(): InputRow[] {
    return [
      { label: 'empty', value: '' },
      { label: 'whitespace only', value: '   ' },
      { label: '51 characters', value: this.createBranchCodeOfLength(51) },
    ];
  }

  /** Branch names the backend must refuse (SUC-004): empty, whitespace only and 101 characters (limit 100). */
  static createInvalidBranchNames(): InputRow[] {
    return [
      { label: 'empty', value: '' },
      { label: 'whitespace only', value: '   ' },
      { label: '101 characters', value: this.createBranchNameOfLength(101) },
    ];
  }

  /** CSV text for `import-csv`: header `CodSede,NombreSede,DireccionSede,Departamento` (`CsvBranchRowDto`) and one row per entry (no quoting needed for generated data). */
  static createBranchCsv(rows: { code: string, name: string, address?: string, department?: string }[], header = 'CodSede,NombreSede,DireccionSede,Departamento'): string {
    return [header, ...rows.map(row => [row.code, row.name, row.address ?? '', row.department ?? ''].join(','))].join('\n');
  }

  // ============================================
  // TERMINALS AND DEVICES (TER cases)
  // ============================================

  /** A unique, well-formed MAC: six hex pairs joined by `separator`, upper or lower case. */
  static createMac(separator: ':' | '-' = ':', casing: 'upper' | 'lower' = 'upper'): string {
    const mac = faker.internet.mac(separator);
    return casing === 'upper' ? mac.toUpperCase() : mac.toLowerCase();
  }

  /** A unique 15-digit IMEI (the only valid shape). */
  static createImei(): string {
    return faker.string.numeric({ length: 15, allowLeadingZeros: true });
  }

  /** Terminal name of EXACTLY `length` characters, `QAX` first (so searches and cleanup recognise it). */
  static createTerminalNameOfLength(length: number): string {
    return `QAX${faker.string.alpha({ length: Math.max(length - 3, 0), casing: 'lower' })}`.slice(0, Math.max(length, 3));
  }

  /** A unique host name the backend accepts (letters, digits, hyphens, dots). */
  static createHostName(): string {
    return `qax-host-${faker.string.alphanumeric({ length: 8, casing: 'lower' })}.local`;
  }

  /** A valid mobile terminal: IMEI included. */
  static createMobileTerminalPayload(branchId: number, overrides?: Partial<CreateTerminalPayload>): CreateTerminalPayload {
    return this.createTerminalPayload(branchId, { DeviceType: 'MOVIL', Imei: this.createImei(), ...overrides });
  }

  /** A valid device for `terminalId`: unique `QAX` code and a unique serial (the serial is unique in the whole system). */
  static createDevicePayload(terminalId: number): CreateDevicePayload {
    return {
      TerminalId: terminalId,
      Code: `QAX-DEV-${faker.string.alphanumeric({ length: 8, casing: 'upper' })}`,
      DeviceName: 'QAX Device',
      SerialNumber: `QAXSN${faker.string.alphanumeric({ length: 10, casing: 'upper' })}`,
    };
  }

  /** Terminal names the case says must be refused (TER-004): empty, whitespace only and 101 characters. The 100-character boundary is accepted. */
  static createInvalidTerminalNames(): InputRow[] {
    return [
      { label: 'empty', value: '' },
      { label: 'whitespace only', value: '   ' },
      { label: '101 characters', value: this.createTerminalNameOfLength(101) },
    ];
  }

  /**
   * MACs that are NOT six hex pairs with a single kind of separator (TER-006, strict format of the case):
   * short, long, non-hex letters, no separators, spaces, mixed separators and the CSV example `ZZ:22`.
   * The empty MAC is its own row because its message is "required".
   */
  static createMalformedMacs(): InputRow[] {
    return [
      { label: 'short (3 pairs)', value: 'AA:BB:CC' },
      { label: 'long (7 pairs)', value: 'AA:BB:CC:DD:EE:FF:00' },
      { label: 'non-hex letters', value: 'ZZ:ZZ:ZZ:ZZ:ZZ:ZZ' },
      { label: 'no separators', value: 'AABBCCDDEEFF' },
      { label: 'with spaces', value: 'AA BB CC DD EE FF' },
      { label: 'mixed separators', value: 'AA:BB-CC:DD-EE:FF' },
      { label: 'two characters (ZZ:22)', value: 'ZZ:22' },
    ];
  }

  /** IPs the backend must refuse (TER-008). */
  static createInvalidIps(): InputRow[] {
    return [
      { label: 'octet over 255', value: '256.1.1.1' },
      { label: 'three octets', value: '1.2.3' },
      { label: 'text', value: 'not-an-ip' },
    ];
  }

  /** Host names with spaces or symbols (TER-009). */
  static createInvalidHostNames(): InputRow[] {
    return [
      { label: 'space', value: 'qax host' },
      { label: 'underscore', value: 'qax_host' },
      { label: 'symbol', value: 'qax!host' },
    ];
  }

  /** IMEIs that are not exactly 15 digits (TER-011). */
  static createInvalidImeis(): InputRow[] {
    return [
      { label: '14 digits', value: '12345678901234' },
      { label: '16 digits', value: '1234567890123456' },
      { label: 'letters', value: '12345678901234A' },
    ];
  }

  /**
   * CSV text for the terminal `import-csv`: header `TerminalName,CodSede,HostName,UserMac,UserIP,IMEI,DpMovil/Fijo`
   * (`CsvTerminalRowDto`) and one row per entry (no quoting needed for generated data).
   */
  static createTerminalCsv(rows: { name: string, branchCode: string, host?: string, mac: string, ip?: string, imei?: string, type?: string }[], header = 'TerminalName,CodSede,HostName,UserMac,UserIP,IMEI,DpMovil/Fijo'): string {
    return [header, ...rows.map(row => [row.name, row.branchCode, row.host ?? '', row.mac, row.ip ?? '', row.imei ?? '', row.type ?? 'FIJO'].join(','))].join('\n');
  }

  // ============================================
  // DEVICES (DIS cases)
  // ============================================

  /** Device code of EXACTLY `length` characters (letters, digits, `-`, `_`), `QAX-` first. */
  static createDeviceCodeOfLength(length: number): string {
    return `QAX-${faker.string.alphanumeric({ length: Math.max(length - 4, 0), casing: 'upper' })}`.slice(0, Math.max(length, 4));
  }

  /** Serial number of EXACTLY `length` characters, `QAXSN` first (the serial is unique in the whole system). */
  static createSerialOfLength(length: number): string {
    return `QAXSN${faker.string.alphanumeric({ length: Math.max(length - 5, 0), casing: 'upper' })}`.slice(0, Math.max(length, 5));
  }

  /** Device name of EXACTLY `length` characters, `QAX` first. */
  static createDeviceNameOfLength(length: number): string {
    return `QAX${faker.string.alpha({ length: Math.max(length - 3, 0), casing: 'lower' })}`.slice(0, Math.max(length, 3));
  }

  /** Device codes the backend must refuse (DIS-004): empty, 51 characters and the symbols the case lists. The 50-character boundary is accepted. */
  static createInvalidDeviceCodes(): InputRow[] {
    return [
      { label: 'empty', value: '' },
      { label: '51 characters', value: this.createDeviceCodeOfLength(51) },
      { label: 'with a space', value: 'QAX DEV 1' },
      { label: 'with @', value: 'QAX-DEV@1' },
      { label: 'with a dot', value: 'QAX-DEV.1' },
      { label: 'with a slash', value: 'QAX-DEV/1' },
      { label: 'with n tilde', value: 'QAX-DEV-ni\u00F1o' },
    ];
  }

  /**
   * CSV text for the device `import-csv`: header `DeviceCode,Serial,DeviceName,TerminalName` (`CsvDeviceRowDto`)
   * and one row per entry (no quoting needed for generated data).
   */
  static createDeviceCsv(rows: { code: string, serial: string, name?: string, terminalName: string }[], header = 'DeviceCode,Serial,DeviceName,TerminalName'): string {
    return [header, ...rows.map(row => [row.code, row.serial, row.name ?? '', row.terminalName].join(','))].join('\n');
  }

  // ============================================
  // USERAPPS (UAP cases)
  // ============================================

  /** Username (lower case, valid characters) of EXACTLY `length` characters, `qa.ua.` first. The username is global. */
  static createUsernameOfLength(length: number): string {
    return `qa.ua.${faker.string.alphanumeric({ length: Math.max(length - 6, 0), casing: 'lower' })}`.slice(0, Math.max(length, 6));
  }

  /** Usernames that use each symbol the backend allows (`@ # / \\ . - _`), one per row, all valid and unique (UAP-002). */
  static createSymbolUsernames(): InputRow[] {
    const id = () => faker.string.alphanumeric({ length: 8, casing: 'lower' });
    return [
      { label: 'at sign', value: `qa.${id()}@example.com` },
      { label: 'hash', value: `qa#${id()}` },
      { label: 'slash', value: `qa/${id()}` },
      { label: 'backslash', value: `qa\\${id()}` },
      { label: 'dot, hyphen and underscore', value: `qa.${id()}-x_y` },
    ];
  }

  /** Usernames with characters the backend must refuse (UAP-003). */
  static createInvalidUsernames(): InputRow[] {
    const id = faker.string.alphanumeric({ length: 8, casing: 'lower' });
    return [
      { label: 'space', value: `qa ua ${id}` },
      { label: 'accent', value: `qa.ua.ni\u00F1o${id}` },
      { label: 'semicolon', value: `qa;${id}` },
      { label: 'dollar sign', value: `qa$${id}` },
    ];
  }

  /** E-mails the backend must refuse (UAP-007): no at sign, no domain dot, a space and 256 characters. */
  static createInvalidEmails(): InputRow[] {
    return [
      { label: 'no at sign', value: 'sin-arroba.example.com' },
      { label: 'no domain dot', value: 'qa@sindominio' },
      { label: 'with a space', value: 'qa user@example.com' },
      { label: '256 characters', value: `${'a'.repeat(244)}@example.com` },
    ];
  }

  /**
   * CSV text for the UserApp `import-csv`: header `CodUser,Email,NombreUser,Cargo` and one row per entry
   * (no quoting needed for generated data). The backend lower-cases the username and generates the password.
   */
  static createUserAppCsv(rows: { user: string, email?: string, name?: string, position?: string }[], header = 'CodUser,Email,NombreUser,Cargo'): string {
    return [header, ...rows.map(row => [row.user, row.email ?? '', row.name ?? '', row.position ?? ''].join(','))].join('\n');
  }

  // ============================================
  // PLATFORM ADMINS AND ROLES (USR cases)
  // ============================================

  /** Personal e-mail domains the Admin username must refuse (USR-003): one unique address per blocked provider. */
  static createPersonalEmails(): InputRow[] {
    const id = () => faker.string.alphanumeric({ length: 8, casing: 'lower' });
    return ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com'].map(domain => ({ label: domain, value: `qa.adm.${id()}@${domain}` }));
  }

  /** Role name of EXACTLY `length` characters, `QAX` first (roles are global). */
  static createRoleNameOfLength(length: number): string {
    return `QAX${faker.string.alpha({ length: Math.max(length - 3, 0), casing: 'lower' })}`.slice(0, Math.max(length, 3));
  }
}

export default DataFactory;
