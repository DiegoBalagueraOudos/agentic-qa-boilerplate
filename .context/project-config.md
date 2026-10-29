# Project Configuration

> Project: Validate (Validate Multitenant, "Tenant Manager")
> Generated: 2026-10-22
> Source: project-discovery Phase 1 (read-only reverse engineering of the two sibling repos). Layout: split repos, merged into this one file.

## Repositories

| Repository | Local path (relative to this repo) | Remote (user info stripped) | Branch | Purpose |
|------------|------------------------------------|-----------------------------|--------|---------|
| Backend `ms_validate_tenant_backend` | `../PruebasMultitenantValidate/ms_validate_tenant_backend` | `https://dev.azure.com/SECURIDSAS/VALIDATE_TENANT_BACKEND/_git/ms_validate_tenant_backend` | `sbx` | REST API + business logic (ASP.NET Core, Clean Architecture) |
| Frontend `spa_validate_tenant_frontend` | `../PruebasMultitenantValidate/spa_validate_tenant_frontend` | `https://dev.azure.com/SECURIDSAS/VALIDATE_TENANT_FRONTEND/_git/spa_validate_tenant_frontend` | `sbx` | Admin panel SPA (Angular) |
| `VersionesBackend/` (sibling folder) | `../PruebasMultitenantValidate/VersionesBackend` | n/a | n/a | IGNORED on purpose (user decision 2026-10-22): older backend copies |

Remotes are Azure DevOps (organisation `SECURIDSAS`), not GitHub: `gh` does not apply to them.

Business documents (secondary sources, team-authored, medium confidence), under `../PruebasMultitenantValidate/`:

| Folder | Content |
|--------|---------|
| `HU Validate/` | User-story set V1/V2.1 (82 stories, 13 functional modules), `Plan de Pruebas Validate*.md` (V2.1, V2.2 variants), traceability and validation spreadsheets, mockups, module mind map |
| `Documentos pruebas/` | `Validate.md` (test report 15-19/10/2026), `MATRIZ_PRUEBAS_VALIDATE.md`, traceability xlsx, Playwright login scripts and captures |

## Tech Stack

### Frontend (`spa_validate_tenant_frontend`)
- Framework: Angular 21 (standalone components, lazy routes, signals; `@ngrx/signals` stores)
- Language: TypeScript ~5.9 (`strict`, `strictTemplates`)
- UI: Taiga UI 5, Tailwind CSS 4, Lucide icons, ApexCharts (dashboard)
- Validation: Zod schemas per DTO (`src/app/schemas/`)
- Security client side: ECDH handshake + AES-GCM payload crypto (`src/app/core/crypto`), HttpOnly-cookie session, CSRF header
- Test tooling declared: Vitest + jsdom (`npm test` = `ng test`), 0 spec files
- Dev server: `ng serve` on `http://localhost:4200`, proxy `/api` -> `https://localhost:7096` (`proxy.conf.json`)
- Container: `Dockerfile` + `nginx/default.conf.template` (CSP, HSTS, security headers)

### Backend (`ms_validate_tenant_backend`)
- Framework: ASP.NET Core on .NET 10 (`net10.0`), solution `MultitenantValidate.sln`
- Projects: `MultitenantValidate.API`, `.Application`, `.Domain`, `.Infrastructure` (Clean Architecture)
- Language: C# (`Nullable` and `ImplicitUsings` enabled)
- ORM: Entity Framework Core 10 (code-first migrations, 31 migrations), providers Npgsql (default) and SqlServer (`DatabaseProvider` switch)
- Libraries: FluentValidation 12, AutoMapper 16, BCrypt.Net-Next (password hashing), MailKit (SMTP), Serilog (console, file, MongoDB sinks), Swashbuckle (Swagger), CsvHelper (bulk import), RabbitMQ.Client 7, MongoDB.Driver, StackExchange.Redis cache
- API conventions: `BaseResponse { success, data, message }`, typed domain exceptions, soft delete, audit log per write

### Database
- Type: PostgreSQL 16 (primary, EF Core) + MongoDB 7 (business logs and Serilog logs) + Redis 8.6 (cache) + RabbitMQ 4 (ATDP download queue)
- Provider: self-hosted containers in `docker-compose.yml` (dev/QA). Production DB host is the client's, deployed on Kubernetes: not visible from the repos
- Access: no DB MCP available this session (dbhub failed to connect). Schema was read from EF migrations and entities, not from a live database

### Infrastructure
- Cloud: client-hosted Kubernetes for production (per `docs/Despliegue.md`); Docker Compose for dev/QA. No cloud account referenced
- Reverse proxy: nginx 1.27 (ports 18080/18443) in front of backend and frontend containers
- CI/CD: none found in either repo (no `.github/`, no Azure Pipelines YAML, no Jenkinsfile)
- Monitoring: Serilog to MongoDB + file; health endpoint `/api/health` (DB, Mongo, Redis, RabbitMQ checks). No APM tool found

### Auth (summary, detail goes to Phase 2)
- Four principal types: `Admin` (system users), `TenantAdmin`, `UserApp`, `TenantApi` (machine login with client id/secret)
- JWT access token (15 min) + refresh token (7 days, rotated, hash stored) in HttpOnly cookies
- End-to-end payload encryption: ECDH P-256 + HKDF + AES-256-GCM, nonce replay protection, CSRF header, login lockout and rate limiting

## Environments

| Environment | URL | Purpose | Access |
|-------------|-----|---------|--------|
| Local (docker compose) | `https://localhost:18443` (`{{environments.local.web_url}}`; nginx HTTPS, self-signed or local certs under `nginx/certs/`, git-ignored) | Full stack dev/QA | Direct; admin seeded on first boot |
| Local (dev servers) | Frontend `http://localhost:4200`, backend Swagger `https://localhost:7096/api/swagger` | Day-to-day dev and the QA window of 15-19/10/2026 | Direct |
| Staging (per project.yaml) | Web/API URLs are `null`; `db_mcp` and `api_mcp` are configured | Not a verified application environment; `testing.default_env` is `local` | No staging URL configured |
| Production (client) | Unknown. Backend compose default for CORS is `https://admin.securidsas.com.co` | Live, client Kubernetes | Not accessible; read-only assumption |

Environment variable NAMES used by the backend (from `.env.example`; values never recorded):
`ASPNETCORE_ENVIRONMENT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `JWT_KEY`, `MASTER_KEY`, `SEED_ADMIN_PASSWORD`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_USERNAME`, `EMAIL_PASSWORD`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `MONGO_LOGS_CONNECTION_STRING`, `MONGO_LOGS_DATABASE`, `MONGO_SERILOG_DATABASE`, `REDIS_CONNECTION_STRING`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, `LogQuery__MaxDateRangeDays`, `APP_BASE_URL`, `CORS_ALLOWED_ORIGINS`. The compose file also reads `ATDP_WORKER_URL`.

QA framework variable NAMES (this boilerplate's `.env.example`): `TEST_ENV`, `LOCAL_USER_EMAIL`, `LOCAL_USER_PASSWORD`, `STAGING_USER_EMAIL`, `STAGING_USER_PASSWORD`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, `XRAY_*`, `API_BASE_URL`, `OPENAPI_SPEC_PATH`, `DBHUB_*`.

## Tools and Access

- Issue tracker: none connected. The Jira values in `.agents/project.yaml` were inherited from the boilerplate and belong to another site; the team has no Jira access for this project (user decision, 2026-10-23)
- Project key: none (project name per yaml: `Validate`)
- Source control for the SUT: Azure DevOps (`dev.azure.com/SECURIDSAS`)
- Database: resolved via [DB_TOOL] (`dbhub`), currently unavailable
- API: resolved via [API_TOOL] (`openapi`), currently unavailable
- Docs: backend wiki sources in `ms_validate_tenant_backend/docs/` (8 pages, Spanish); test reports and plans in the sibling document folders
- API test assets: Postman collection and environment at `ms_validate_tenant_backend/tests/postman/` (untracked in the backend repo)

## API spec source

- Generator: Swashbuckle (`Swashbuckle.AspNetCore` 10.2.3), registered in `ms_validate_tenant_backend/MultitenantValidate.API/Extensions/SwaggerExtension.cs`. No `openapi.*` or `swagger.*` file is committed in either repository.
- Reachable spec (OpenAPI 3.0.4, title "MultitenantValidate API"): `https://localhost:18443/api/swagger/v1/swagger.json` on the local Compose stack (read on 2026-10-22: 70 paths, 105 operations, security scheme `Bearer`). The dev server serves it at `https://localhost:7096/api/swagger/v1/swagger.json`. Swagger is only mapped outside Production, so staging/production hosts will not serve it.
- For `bun run api:sync`: pass that URL (self-signed certificate on the local stack) or save the JSON and use `--file`. Set `OPENAPI_SPEC_PATH` to the same URL for the `openapi` MCP.
- Spot-check against controllers (5 of 5 match): `POST /api/auth/login/admin`, `POST /api/handshake`, `POST /api/Synchronize/branch`, `POST /api/Validation/mac-serial`, `POST /api/logs/atdp/export`. Count check: 110 HTTP verb attributes in the controllers minus the 5 in `RoleController` (hidden with `IgnoreApi`) equals the 105 operations.
- Limits of the spec: it describes plaintext DTOs while twelve route prefixes carry `{ct, nonce}` envelopes on the wire (see infra map `architecture`, ADR-0018); the Role endpoints are hidden from it on purpose.
- Next step for the business angle: `/project-context api` after discovery completes.

## Access Checklist

- [x] Repository read access (both repos readable locally, branch `sbx`)
- [ ] Database access (MCP or direct): BLOCKER for live-data inspection. `dbhub` MCP failed to connect (CONNECTION_CLOSED). Discovery used migrations and entities instead
- [x] API contract access: a live OpenAPI spec is reachable on the local stack (see "API spec source"). The `openapi` MCP failed to connect this session, so the spec was fetched with a plain GET and `bun run api:sync` has not been run yet
- [ ] Issue tracker access: NONE. Phase 4 did not run `bun run jira:check` because the team will not connect Jira (see Discovery Gaps)
- [ ] Staging environment reachable: NOT configured in `.agents/project.yaml` (web/API URLs are `null`); no staging URL was found in the application repositories
- [ ] CI/CD visibility: none exists in the repos; Azure DevOps pipelines (if any) are not visible from the files

## Discovery Gaps

- [ ] `.agents/project.yaml` `database.db_type` is `null`; the repos define PostgreSQL 16 in Docker plus MongoDB, Redis and RabbitMQ. Confirm the database value to use in the framework configuration.
- [ ] `.agents/project.yaml` `webapp_domain` and the QA, staging and production web/API URLs are `null`. Confirm Validate's domain and any client QA/staging URLs.
- [ ] Production URL and the client's Kubernetes manifests are not in the repos (only described in `docs/Despliegue.md`).
- [ ] No live DB access: column-level types, indexes and constraints were read from migration code only; real data volumes unknown.
- [ ] `bun run api:sync` not yet run: `api/openapi-types.ts` is still the stub; the spec is reachable (see "API spec source"). Endpoint inventory in Phase 1 was documentation-derived; Phase 2 confirmed 105 operations against the controllers.
- [ ] `VersionesBackend/` was excluded by decision; if the deployed version differs from branch `sbx`, findings may drift.
- [ ] External systems named in the docs (ATDP worker, operators of the national registry, the biometric "Listener" desktop component) have no code in these repos.
- [ ] `ms_validate_tenant_backend/tests/postman/` is untracked and was not inspected beyond file names (the environment file may hold credentials; not opened).
- [ ] Team contacts were not asked (LOW priority, not needed to unblock).
- [ ] No issue-tracker connection (Phase 4, 2026-10-23): the user stated there will be no Jira connection, so `bun run jira:check` was not run and `.context/PBI/` stays as shipped. Consequence: `/sprint-testing`, `/shift-left-testing` and `/test-documentation` cannot read or create tickets; the user stories live as documents in `HU Validate/`. Next step if this changes: set `ATLASSIAN_EMAIL` and `ATLASSIAN_API_TOKEN` in `.env` (typed by the user), set `issue_tracker.atlassian_url` and `project.project_key` in `.agents/project.yaml` to the team's real site and key, then run `bun run jira:sync-fields` and `bun run jira:check`.
- [ ] Inherited Jira values in `.agents/project.yaml` (`atlassian_url`, `project_key`, `qa.qa_epics.*.key`) pointed at another site; they are now `null`, as are `webapp_domain`, `db_type` and the QA/staging/production URLs. `environments.local.api_url` is `https://localhost:18443/api`, and `testing.default_env` is `local`; the Compose stack is the configured test target.
