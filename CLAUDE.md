# Invoicely: map, commands, rules

Accounting and invoicing for Bulgarian accountants. pnpm monorepo, strict TypeScript, Node 22, pnpm 10.34.9.

## Map

- `apps/web`: React SPA built with Vite. Screens only; no business rules.
- `apps/api`: NestJS. Thin handlers: validate, call `packages/domain` and `packages/db`, map the result.
- `packages/domain`: business rules (VAT, money, documents). Pure, no I/O.
- `packages/db`: Drizzle schema and data access for Supabase Postgres.
- `packages/shared`: types and contracts shared by web and api.
- `e2e/`: repo-level tests, run by `pnpm test`.
- `fixtures/etalons/`: the accountant's reference outputs. Locked.

Architecture: INV-27 (web), INV-28 (api, domain, shared), INV-29 (data model), in Linear.

## Commands (from the root)

- `pnpm install`: install everything (CI uses `--frozen-lockfile`).
- `pnpm dev`: start web (Vite) and api (NestJS, port 3000) locally.
- `pnpm build`: build every package.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`: the CI checks; all three must pass on every PR.

## Rules

- Money is integer euro cents, through `packages/domain` money helpers. Euro only; no lev, no floats.
- `fixtures/etalons/` is locked: never edit, reformat or regenerate it.
- Strict TypeScript: no `any`, no `@ts-ignore`, no non-null assertions.
- `.github/` belongs to Yoan; agents do not change it.
- Add a dependency only when a task or ADR needs it.
