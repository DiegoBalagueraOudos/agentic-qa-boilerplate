---
id: project
title: 'Project-specific instructions'
load_when: 'anything specific to this project: its own conventions, guardrails, environments or vocabulary not covered by another section'
triggers: ['\b(?:test-(?:automation|documentation)|bug-report)-local\b', '\breportar (?:el |un )?bug\b', '\bbug de producto\b', '\bqa:local\b', '\bcasos? locales?\b', '\bsin (?:jira|xray)\b.*\b(?:casos?|pruebas?)\b']
paths: []
---

# Project-specific instructions

> Project-owned overlay. The boilerplate delivers this file once and never overwrites it; every other file in this folder is synced from upstream. Write this project's own rules here, one heading per topic, instead of editing `AGENTS.md` or a synced section. Knowledge about the system under test belongs in a project context skill (`<aspect>-context`), not here.

Add `triggers:` regex sources to the frontmatter above when a rule here should be routed by keyword (the hook reads them), and keep every `NEVER` / `MUST` line reachable: cite `Rule #N`, binding: `/<skill>`, or enforced: `bun run <script>` (checked by `bun run instructions:check`).

## Project context skills

One row per skill this project authored: the `<aspect>-context` skills `project-context` mode `context-skill` creates, and any other skill the project added. The skill router in `agent-skills-and-mcps.md` is synced, so `bun sync` overwrites a row written there; this file is never overwritten. Add each skill's trigger phrases to `triggers:` above as regex sources too, so the hook routes this file when a prompt names them. `bun run instructions:check` fails a row whose `.agents/skills/<slug>/SKILL.md` does not exist.

| Skill | Trigger | Purpose |
|---|---|---|
| `test-documentation-local` | triage / diseñar / veredicto de casos locales, `qa:local`, sin Jira ni Xray | Triage, diseño y veredicto de automatización de los casos de prueba guardados como archivos locales; el estado lo cambia solo `bun run qa:local`. Variante sin tracker de `/test-documentation`. |
| `test-automation-local` | automatizar casos locales (`next`, `ola`, `prefix`, `case`), sin Jira ni Xray | Plan, código y revisión de pruebas Playwright con KATA a partir de los casos locales, en el orden de olas de riesgo. Variante sin tracker de `/test-automation`. |
| `bug-report-local` | reportar un bug de producto hallado por una prueba automatizada fallida, `bug-report-local` | Juzga si el fallo es del producto, reúne la evidencia sin secretos, propone el reporte y espera el visto bueno antes de crear nada; numera `<caso>-BUG-<n>` con `qa:local bug` y usa la skill `/bug-screenshot-annotation` existente para los bugs visuales. |

## Generated context maps

- Business data: `.agents/skills/business-data-context/references/business-data-map.html` (read via `bun run context:map business-data-context`).
- Business journeys and features: `.agents/skills/business-e2e-context/references/business-e2e-map.html` (read via `bun run context:map business-e2e-context`).
- Business API: `.agents/skills/business-api-context/references/business-api-map.html` (read via `bun run context:map business-api-context`).

## Git Strategy (this repository)

This repository's strategy is chosen, not inherited (`meta.strategy_source` in the yaml records it; ADR-0006 records when): do not re-offer Strategy Setup here unless the user asks to change the strategy.

**Accepted divergence, declared policy vs enforced ruleset.** The one intended disagreement between yaml and host is formally declared in `git_strategy.policy.accepted_divergences` (`.agents/project.yaml`):

```
main.direct_push_to_protected   declared: allowed   enforced: blocked (pull_request rule)
```

The ruleset named in that entry requires a pull request on `main`. This repo pushes directly anyway, because the push credential sits in that ruleset's bypass list (the ruleset id: ADR-0006). The remote line `Bypassed rule violations ... Changes must be made through a pull request` is expected here and is not an error. The yaml stays `allowed` because that is how work actually lands (standing authorization: Critical Rule #5 resolves to it); the host rule keeps protecting every non-bypass contributor. Both sides are correct on purpose. How `verify`, `--stamp` and `apply` treat an accepted field: `agent-git.md` → Accepted divergences (mechanism).

This exception belongs to THIS repository and travels nowhere: this file is project-owned, and a downstream project receives a generic stub, never this text. A project scaffolded from this boilerplate defines its own answer during Strategy Setup, and `git-flow-master` reports what THAT host enforces.

## Test framework adaptation

- **Auth strategy**: the encrypted human session of ADR-0018, never a plaintext or CSRF bypass. UI tests sign in through the real SPA login; API tests open the ECDH session in `tests/components/api/SecureApi.ts` over the pure helper `tests/utils/cryptoSession.ts`. Session material (cookies, session id, AES key) lives only under the ignored `.auth/`. The machine-client flow (`bun run api:login`, `/Auth/login/api`) is deferred until its response contract is verified.
- **ATC ids are the local case ids** under `.context/QA/cases/` (`AUT-002`, ...). There is no TMS. An id appears on exactly one `@atc` (enforced: `bun run kata:manifest:check`); a case with both a UI and an API variant carries its id on one of them. Test titles start with the same id.
- **OpenAPI**: the source is the live Swagger at `OPENAPI_SPEC_PATH`, refreshed with `bun run api:sync`. The contract declares no response bodies for the auth routes, so their response shapes are hand-written in `api/schemas/auth.types.ts`.
- **UI session reuse**: Playwright `storageState` does not carry `sessionStorage`, where the SPA keeps its UI metadata. `ui-auth.setup.ts` saves it and the `page` fixture in `tests/components/TestFixture.ts` restores it only when the session cookie is present.
- **Open gaps and deferred scope**: `Discovery Gaps` in `.context/reports/test-framework-adaptation-plan.md` is the record (Tenant component, CI, machine login).

## Project Assessment (Phase 1)

Assessment Date: 2026-10-22

Scope: both split repos on branch `sbx` (`ms_validate_tenant_backend`, `spa_validate_tenant_frontend`); the `VersionesBackend/` copy is excluded by decision.

### Testing Maturity: 1/4
- Current state: Basic (no automated unit, integration or E2E test files in either repo; an API collection exists)
- Test files: 0 in the backend (`*.test.*`, `*.spec.*`, `*Tests.cs`), 0 in the frontend (`*.spec.ts`)
- Frameworks: backend none (no test project in `MultitenantValidate.sln`); frontend declares Vitest + jsdom (`npm test`) with no specs; Postman collection and environment in the backend `tests/postman/` (untracked in git)
- Coverage: unknown (not measured)
- Manual QA is substantial but lives outside the repos: V2.2 test plans, traceability matrices, and a test report dated 15-19/10/2026 in the sibling document folders

### Documentation State: Good
- README: yes in both, but both are the untouched Azure DevOps template (TODO text)
- API docs: yes (`docs/API-Endpoints.md`, Swagger at runtime)
- Architecture: yes (`docs/Arquitectura.md`, `docs/Modelo-de-dominio.md`, `docs/Seguridad.md`, `docs/Despliegue.md`); backend only
- Setup guide: yes (`docs/Puesta-en-marcha.md`); frontend has none

### Code Quality
- [ ] ESLint: missing in both repos
- [x] Prettier: configured in the frontend (`package.json`); missing in the backend (C# repo, no `.editorconfig`)
- [x] TypeScript: strict (`strict`, `strictTemplates`); backend C# has `Nullable` enabled
- [ ] Pre-commit hooks: missing in both repos
- Extra: the frontend has `npm run styles:guardrails` (`scripts/style-guardrails.mjs`)

### CI/CD Maturity: None
- No `.github/`, no Azure Pipelines YAML, no other pipeline file in either repo. Delivery artifacts exist (Dockerfiles, `docker-compose.yml`, nginx config) but nothing runs build, lint or tests automatically from the repos.

### Identified Risks

| Risk | Severity | Evidence (path only) | Mitigation |
|------|----------|----------------------|------------|
| Secrets held in a local config file (JWT signing key, server master key, database and broker and SMTP credentials; the backend docs call them dev defaults). The file is git-ignored and has no history on any branch, so it is not committed; the tracked `docker-compose.yml` does carry an inline default fallback for the Postgres password | MEDIUM | `ms_validate_tenant_backend/MultitenantValidate.API/appsettings.json` (local, ignored), `ms_validate_tenant_backend/docker-compose.yml` | Confirm none is reused outside local dev, rotate if so; move to environment variables or a secret store; never record values in discovery docs |
| No automated tests in either repo | HIGH | `ms_validate_tenant_backend/` (no test project), `spa_validate_tenant_frontend/src/` (0 spec files) | Seed the automation plan from the existing manual plans and the Postman collection (Phase 4 handoff to `project-context` mode `test-plan`) |
| No CI of any kind | MEDIUM | `ms_validate_tenant_backend/`, `spa_validate_tenant_frontend/` (no pipeline files) | Confirm whether Azure DevOps pipelines live outside the repos; plan a build + test gate during framework adaptation |
| Private TLS key present on disk (git-ignored, not tracked) | LOW | `ms_validate_tenant_backend/nginx/certs/privkey.pem` | Keep ignored; never read or copy it |
| No lint or pre-commit gates | MEDIUM | `spa_validate_tenant_frontend/package.json` | Out of QA scope; report to the team |
| Declared `db_type` in project.yaml contradicts the repos (Supabase Postgres vs PostgreSQL + MongoDB + Redis + RabbitMQ) | MEDIUM | `.agents/project.yaml` | Correct during framework adaptation |

### Phase Prioritization

- Phase 1: Normal -- both repos readable, domain vocabulary well documented in code and Spanish docs
- Phase 2: Extended -- end-to-end payload encryption, four principal types, tenant isolation, queue-based ATDP flow and external systems need careful architecture/NFR capture
- Phase 3: Normal -- Docker Compose and nginx are explicit; Kubernetes and CI/CD are absent from the repos, so those parts are recorded as gaps
- Phase 4: Extended -- 82 user stories in 13 modules and prior test plans exist to map; Jira access still unverified

### Blockers
- [ ] `dbhub` and `openapi` MCPs failed to connect this session: restart the session after fixing their environment variables, or accept migration-based schema reading
- [ ] Hardcoded-secret and no-tests/no-CI risks are HIGH: the user must acknowledge them before Phase 2 (they do not block read-only discovery)
- [ ] Confirm real staging/QA URLs for Validate (project.yaml values look inherited from another product)
