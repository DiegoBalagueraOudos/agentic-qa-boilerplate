# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: integration\dis\device-csv-import.test.ts >> DIS: device CSV import >> DIS-010: should import devices from CSV and report per-row errors
- Location: tests\integration\dis\device-csv-import.test.ts (L34)

# Error details

```
Error: 3 device CSV import checks failed. mixed file: HTTP 200, total 9 imported 3 failed 6 (expected 9, 2, 7); mixed file: no error on row 9 for Code (got none); mixed file: 6 error entries (expected 7, one per bad row)
```

# Test source

```ts
  110 | 
  111 |   /** List a tenant's devices; asserts nothing. */
  112 |   async listDevices(tenantId: number, query: DeviceListQuery = {}): Promise<[APIResponse, ApiEnvelope<PagedData<DeviceData>>]> {
  113 |     const params = new URLSearchParams();
  114 |     if (query.page !== undefined) { params.set('Page', String(query.page)); }
  115 |     if (query.pageSize !== undefined) { params.set('PageSize', String(query.pageSize)); }
  116 |     if (query.searchTerm !== undefined) { params.set('SearchTerm', query.searchTerm); }
  117 |     const text = params.toString();
  118 |     return this.secureGET<PagedData<DeviceData>>(`/tenants/${tenantId}/devices${text === '' ? '' : `?${text}`}`);
  119 |   }
  120 | 
  121 |   /** Upload one CSV file (multipart, not encrypted); asserts nothing. */
  122 |   async importCsv(tenantId: number, file: { name: string, content: string }): Promise<[APIResponse, ApiEnvelope<BulkImportResultData>]> {
  123 |     return this.secureMultipartPOST<BulkImportResultData>(`/tenants/${tenantId}/devices/import-csv`, {
  124 |       name: file.name,
  125 |       mimeType: 'text/csv',
  126 |       buffer: Buffer.from(file.content, 'utf8'),
  127 |     });
  128 |   }
  129 | 
  130 |   /** Read one device; asserts nothing. */
  131 |   async getDevice(tenantId: number, deviceId: number): Promise<[APIResponse, ApiEnvelope<DeviceData>]> {
  132 |     return this.secureGET<DeviceData>(`/tenants/${tenantId}/devices/${deviceId}`);
  133 |   }
  134 | 
  135 |   /** Activate or deactivate a device. Fixed assertions: 200, `Ok`. */
  136 |   @step
  137 |   async setDeviceActive(tenantId: number, deviceId: number, isActive: boolean): Promise<[APIResponse, ApiEnvelope<unknown>]> {
  138 |     const [response, body] = await this.securePUT<unknown, UpdateDevicePayload>(`/tenants/${tenantId}/devices/${deviceId}`, { IsActive: isActive });
  139 | 
  140 |     expect(response.status(), `set device active=${String(isActive)}: ${body.CodeError ?? 'no error code'}`).toBe(200);
  141 |     expect(body.Ok).toBe(true);
  142 | 
  143 |     return [response, body];
  144 |   }
  145 | 
  146 |   /** Soft-delete a device; asserts nothing (cleanup tolerates a device that is already gone). */
  147 |   async attemptDeleteDevice(tenantId: number, deviceId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
  148 |     return this.secureDELETE<unknown>(`/tenants/${tenantId}/devices/${deviceId}`);
  149 |   }
  150 | 
  151 |   // ============================================
  152 |   // Internals shared by the ATCs
  153 |   // ============================================
  154 | 
  155 |   /** First line of an error, for a failure list (no stack, no call log). */
  156 |   private firstLine(error: unknown): string {
  157 |     return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  158 |   }
  159 | 
  160 |   /** The device id an answer created, or 0. */
  161 |   private createdId(body: ApiEnvelope<CreatedEntityData>): number {
  162 |     const id = body.Data?.Id;
  163 |     return typeof id === 'number' && id > 0 ? id : 0;
  164 |   }
  165 | 
  166 |   /** Delete generated devices, tolerating the ones already gone (404). Returns one line per failure. */
  167 |   private async cleanupCreated(tenantId: number, deviceIds: number[]): Promise<string[]> {
  168 |     const failures: string[] = [];
  169 |     for (const id of deviceIds) {
  170 |       try {
  171 |         const [response] = await this.attemptDeleteDevice(tenantId, id);
  172 |         if (response.status() !== 200 && response.status() !== 404) {
  173 |           failures.push(`delete device #${id}: HTTP ${response.status()}`);
  174 |         }
  175 |       }
  176 |       catch (error) {
  177 |         failures.push(`delete device #${id}: ${this.firstLine(error)}`);
  178 |       }
  179 |     }
  180 |     return failures;
  181 |   }
  182 | 
  183 |   /** Create a device and record its id for cleanup BEFORE judging the answer. */
  184 |   private async createTracked(tenantId: number, payload: object, createdIds: number[]): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
  185 |     const answer = await this.attemptCreateDevice(tenantId, payload);
  186 |     const id = this.createdId(answer[1]);
  187 |     if (id > 0) {
  188 |       createdIds.push(id);
  189 |     }
  190 |     return answer;
  191 |   }
  192 | 
  193 |   /** Common frame of the catalog ATCs: one Administrator session, collected failures, cleanup of what the body created, one thrown error. */
  194 |   private async runCatalogCase(args: { what: string, tenantId: number, body: (createdIds: number[], failures: string[]) => Promise<void> }): Promise<void> {
  195 |     const createdIds: number[] = [];
  196 |     const failures: string[] = [];
  197 |     await this.openAdministratorSession();
  198 |     try {
  199 |       await args.body(createdIds, failures);
  200 |     }
  201 |     catch (error) {
  202 |       failures.push(`unexpected: ${this.firstLine(error)}`);
  203 |     }
  204 |     finally {
  205 |       failures.push(...await this.cleanupCreated(args.tenantId, createdIds));
  206 |       await this.postLogout().catch(() => undefined);
  207 |     }
  208 | 
  209 |     if (failures.length > 0) {
> 210 |       throw new Error(`${failures.length} ${args.what} checks failed. ${failures.join('; ')}`);
      |             ^ Error: 3 device CSV import checks failed. mixed file: HTTP 200, total 9 imported 3 failed 6 (expected 9, 2, 7); mixed file: no error on row 9 for Code (got none); mixed file: 6 error entries (expected 7, one per bad row)
  211 |     }
  212 |   }
  213 | 
  214 |   /**
  215 |    * Shared body of the DIS input cases. Own crypto session, ONE positive Administrator login. The positive
  216 |    * control first (a valid device on a fresh terminal), then every row. A `reject` row must answer its status
  217 |    * (400 unless set), `Ok` false, its code (`VALIDATION_ERROR` unless set) and carry its message, and create
  218 |    * nothing: the tenant's device total must equal the base plus what was created so far. An `accept` row must
  219 |    * answer 200. A reject row the product wrongly accepts is tracked and reported, and the loop goes on (each row
  220 |    * has its own terminal, so one accepted row hides nothing). Everything created is deleted before the session closes.
  221 |    */
  222 |   private async runDeviceInput(args: { scope: DeviceScope, rows: DeviceInputRow[], what: string, extra?: (createdIds: number[], failures: string[]) => Promise<void> }): Promise<void> {
  223 |     const { tenantId } = args.scope;
  224 |     const createdIds: number[] = [];
  225 |     const failures: string[] = [];
  226 |     await this.openAdministratorSession();
  227 |     try {
  228 |       const [, base] = await this.listDevices(tenantId, { pageSize: 1 });
  229 |       const baseTotal = base.Data?.TotalRecords ?? 0;
  230 |       const controlTerminalId = await args.scope.newTerminal();
  231 |       const control = this.data.createDevicePayload(controlTerminalId);
  232 |       const [response, body] = await this.createTracked(tenantId, control, createdIds);
  233 |       expect(response.status(), `control (valid device): ${body.CodeError ?? 'no error code'} ${JSON.stringify(body.ValidationErrors ?? [])}`).toBe(200);
  234 | 
  235 |       for (const row of args.rows) {
  236 |         try {
  237 |           const payload = await row.build({ controlTerminalId, control });
  238 |           const [rowResponse, rowBody] = await this.createTracked(tenantId, payload, createdIds);
  239 |           const status = rowResponse.status();
  240 |           const id = this.createdId(rowBody);
  241 |           if (row.outcome === 'accept') {
  242 |             if (status !== 200 || rowBody.Ok !== true || id === 0) {
  243 |               failures.push(`${row.label}: expected ACCEPTED (200), got HTTP ${status} ${rowBody.CodeError ?? 'no error code'}`);
  244 |             }
  245 |             continue;
  246 |           }
  247 |           if (id > 0) {
  248 |             failures.push(`${row.label}: the product ACCEPTED the create (HTTP ${status}, ${rowBody.CodeError ?? 'no error code'})`);
  249 |             continue;
  250 |           }
  251 |           const expectedStatus = row.status ?? 400;
  252 |           const expectedCode = row.code ?? 'VALIDATION_ERROR';
  253 |           const text = `${rowBody.Error ?? ''} ${JSON.stringify(rowBody.ValidationErrors ?? [])}`;
  254 |           if (status !== expectedStatus || rowBody.Ok !== false || rowBody.CodeError !== expectedCode) {
  255 |             failures.push(`${row.label}: HTTP ${status} Ok=${String(rowBody.Ok)} CodeError=${String(rowBody.CodeError)} (expected ${expectedStatus}, false, ${expectedCode})`);
  256 |           }
  257 |           else if (!row.message.test(text)) {
  258 |             failures.push(`${row.label}: HTTP ${status} ${expectedCode}, the message ${row.message} is missing`);
  259 |           }
  260 |           const [, list] = await this.listDevices(tenantId, { pageSize: 1 });
  261 |           if ((list.Data?.TotalRecords ?? 0) !== baseTotal + createdIds.length) {
  262 |             failures.push(`${row.label}: the device total changed after the rejected create`);
  263 |           }
  264 |         }
  265 |         catch (error) {
  266 |           failures.push(`row ${row.label}: ${this.firstLine(error)}`);
  267 |         }
  268 |       }
  269 |       await args.extra?.(createdIds, failures);
  270 |     }
  271 |     catch (error) {
  272 |       failures.push(`control: ${this.firstLine(error)}`);
  273 |     }
  274 |     finally {
  275 |       failures.push(...await this.cleanupCreated(tenantId, createdIds));
  276 |       await this.postLogout().catch(() => undefined);
  277 |     }
  278 | 
  279 |     if (failures.length > 0) {
  280 |       throw new Error(`${failures.length} ${args.what} checks failed. ${failures.join('; ')}`);
  281 |     }
  282 |   }
  283 | 
  284 |   /** A valid device payload on a fresh terminal, with overrides. */
  285 |   private async deviceOnNewTerminal(scope: DeviceScope, overrides: Partial<CreateDevicePayload> = {}): Promise<object> {
  286 |     return { ...this.data.createDevicePayload(await scope.newTerminal()), ...overrides };
  287 |   }
  288 | 
  289 |   // ============================================
  290 |   // Test Cases (ATCs): input validation (DIS-003 .. DIS-008)
  291 |   // ============================================
  292 | 
  293 |   /**
  294 |    * DIS-003: a device needs a valid terminal. Control first; then the terminal omitted and 0 (400
  295 |    * `VALIDATION_ERROR` naming the terminal), a nonexistent terminal (404 `TERMINAL_NOT_FOUND`) and an inactive
  296 |    * terminal (400 `TERMINAL_INACTIVE`). Nothing is created.
  297 |    */
  298 |   @atc('DIS-003')
  299 |   async rejectMissingTerminal(args: { scope: DeviceScope, inactiveTerminal: () => Promise<number> }): Promise<void> {
  300 |     const { scope } = args;
  301 |     const withoutTerminal = async (): Promise<object> => {
  302 |       const payload: Record<string, unknown> = { ...(await this.deviceOnNewTerminal(scope)) };
  303 |       delete payload.TerminalId;
  304 |       return payload;
  305 |     };
  306 |     const rows: DeviceInputRow[] = [
  307 |       { label: 'terminal omitted', build: withoutTerminal, outcome: 'reject', message: /terminal v.lida/i },
  308 |       { label: 'terminal 0', build: async () => this.deviceOnNewTerminal(scope, { TerminalId: 0 }), outcome: 'reject', message: /terminal v.lida/i },
  309 |       { label: 'terminal does not exist', build: async () => this.deviceOnNewTerminal(scope, { TerminalId: 999999999 }), outcome: 'reject', status: 404, code: 'TERMINAL_NOT_FOUND', message: /terminal/i },
  310 |       { label: 'terminal inactive', build: async () => this.deviceOnNewTerminal(scope, { TerminalId: await args.inactiveTerminal() }), outcome: 'reject', code: 'TERMINAL_INACTIVE', message: /inactiva/i },
```