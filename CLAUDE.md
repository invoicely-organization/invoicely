# Invoicely: map, commands, rules

Accounting and invoicing for Bulgarian accountants. pnpm monorepo, strict TypeScript, Node 22, pnpm 10.34.9.

The ADRs and the Речник live in Linear and are not copied here; the runner gives them to each task. Where a rule below
comes from, it names the ADR by its title.

## Map

- `apps/web`: React SPA built with Vite. Screens only; no business rules, no money math. (ADR-001 Frontend архитектура)
- `apps/api`: NestJS. Thin handlers: validate, call `packages/domain` and `packages/db`, map the result.
  (ADR-002 Backend и API)
  - `apps/api/src/modules/<module>/`: one folder per module of ADR-011; another module imports it only through its
    `index.ts`, which starts with a comment of what the module owns.
  - `apps/api/src/common/`: infrastructure (`db`, `jobs`, `idempotency`, `mail`, `registry`, `health`, ...). It never
    imports a module.
- `packages/domain`: business rules (money, calendar, VAT, posting, bank, checks). Pure, no I/O.
- `packages/db`: Drizzle schema and data access for Supabase Postgres; `packages/db/owners.ts` names the owner of every
  table. (ADR-003 Модел на данните)
- `packages/shared`: the contract shared by web and api: zod schemas, enums, error codes.
- `e2e/`: repo-level tests, run by `pnpm test`.
- `fixtures/etalons/`: the accountant's reference outputs. Locked.

Packages may import (ADR-002 Backend и API): `shared` nothing of ours; `domain` only `shared`; `db` only `shared`;
`apps/api` `shared`, `domain`, `db`; `apps/web` only `shared`. No cycles.

## Commands (from the root)

- `pnpm install`: install everything (CI uses `--frozen-lockfile`).
- `pnpm dev`: start web (Vite, http://localhost:5173) and api (NestJS, port 3000; `GET /health`, routes under `/api/v1`).
- `pnpm build`: build every package.
- `pnpm typecheck`: `tsc` in every workspace.
- `pnpm lint`: ESLint and dependency-cruiser (`.dependency-cruiser.mjs`); both run, either one makes it red.
- `pnpm test`: `vitest run` over `packages/**` and `apps/**`, then the `e2e/` suite on `node --test`.
- CI runs `pnpm typecheck`, `pnpm lint` and `pnpm test`; all three must pass on every PR.

## Modules and data ownership (ADR-011 Модули и собственост на данните)

**Levels.** A module uses modules of a lower level; within its level only those in "Uses also". Every module uses
`workspaces` (the access guard) and `audit`; `workspaces` uses only `audit`; `audit` uses nothing. No cycles.
`.dependency-cruiser.mjs` holds this table as data: change ADR-011 first, then the table.

| Level | Module | Does | Owns (tables) | Queues | Uses also |
| -- | -- | -- | -- | -- | -- |
| L0 | workspaces | workspaces, members, invitations, access to companies | `users`, `workspaces`, `workspace_members`, `invitations`, `company_access` | | |
| L0 | audit | the audit log | `audit_log` (written by a trigger) | `audit.partitions` | |
| L0 | files | files in Storage | `files` | | |
| L0 | accounts | chart of accounts and reference rules | `accounts`, `account_templates`, `categories`, `posting_rules`, `company_posting_rules`, `vat_treatments`, `parameters` | | |
| L0 | periods | periods, locking, submissions, deadline rules | `periods`, `submissions`, `fiscal_years`, `holidays`, `deadline_rules` | | |
| L0 | companies | companies, vehicles, VAT regime, transfers | `companies`, `vehicles`, `company_vat_regimes`, `company_transfers` | | accounts |
| L1 | counterparties | counterparties, IBANs, VIES | `counterparties`, `counterparty_ibans`, `vies_checks` | | |
| L1 | documents | incoming and outgoing documents, AI extraction, company memory | `documents`, `document_lines`, `document_kinds`, `products`, `ai_extractions`, `company_memory` | `documents.extract` | counterparties |
| L1 | invoicing | issuing: sequences, numbers, PDF | `number_sequences`, `issued_numbers` | `invoicing.pdf` | counterparties, documents |
| L2 | posting | posting; the only writer of journal entries | `journal_entries`, `journal_lines`, `manual_entries`, `manual_entry_lines` | `posting.batch-book` | |
| L2 | bank | statements, transactions, payments, settlements | `bank_accounts`, `import_mappings`, `bank_statements`, `bank_transactions`, `payments`, `settlements` | `bank.import` | posting |
| L2 | vat | VAT journals, return, VIES, NAP files, refunds, partial credit | `vat_returns`, `vat_refund_balances`, `vat_refund_uses`, `vat_credit_coefficients` | `vat.export` | bank |
| L2 | payroll | employees, contracts, payroll, NOI | `employees`, `employment_contracts`, `payroll_items` | with the payroll stage | posting |
| L3 | tasks | deadlines, tasks, company state for the dashboard | `deadlines`, `tasks`, `company_states` | `tasks.nightly`, `tasks.refresh` | |
| L3 | checks | checks and findings | `findings` | `checks.run`, `checks.ai-review`, `checks.dead-letter` | tasks |
| L3 | reports | reports, read only | | | |
| L3 | onboarding | onboarding and back import | `onboarding_imports`, `import_consents` | `onboarding.import` | |
| L3 | dashboard | the dashboard; the only read across companies | | | tasks |

Infrastructure (`apps/api/src/common`, not a module): `common/jobs` owns `operations` and the queue `jobs.cleanup`;
`common/idempotency` owns `idempotency_keys`; `common/mail` owns the queue `mail.send`; `common/db` is the database
client and the transactions. `checks.run` belongs to `checks` but is enqueued only through `enqueueChecks` in
`common/jobs`.

**Ownership.** Every table and every queue has exactly one owner; only the owner writes the table and handles the queue.
Others read through the owner's `<module>.queries.ts` (ready objects, not Drizzle rows) and write through its service.
The repository is private to its module. `packages/db/owners.ts` lists the owner of every table, and
`packages/db/owners.test.ts` fails CI for a table without an owner or with two. A new module, table or queue goes into
ADR-011 first, then into `owners.ts` and the code.

**Module files.** `<module>.controller.ts` (routes), `<module>.service.ts` (scenarios; the only writer of the module's
tables), `<module>.repository.ts` (private queries), `<module>.queries.ts` (read-only queries for others),
`<module>.jobs.ts` (queues, named `<module>.*`, with explicit retries and backoff), `<module>.module.ts`, `index.ts`.
`drizzle-orm` and raw SQL are allowed only in `*.repository.ts`, `*.queries.ts` and `common/db` (ESLint).

**One name for one thing.** A module's name is the same in its folder, its Nest module (`DocumentsModule`), the prefix of
its queues and its table exports. Routes use the words of the Речник. A second name for the same thing is forbidden:
`posting`, `posting.*` and `/journal-entries`, never `journal/`, `ledger.post` or `/entries`.

**Keep it current.** This map and the comment at the top of each module's `index.ts` change in the same PR as the code.

## Rules

- Money is integer euro cents, through `packages/domain` money helpers. Euro only; no lev, no floats.
- `fixtures/etalons/` is locked: never edit, reformat or regenerate it.
- Strict TypeScript: no `any`, no `@ts-ignore`, no non-null assertions.
- `.github/` belongs to Yoan; agents do not change it.
- Add a dependency only when a task or ADR needs it.

ADRs referred to: ADR-001 Frontend архитектура, ADR-002 Backend и API, ADR-003 Модел на данните, ADR-011 Модули и
собственост на данните.
