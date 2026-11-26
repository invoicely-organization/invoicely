// INV-65 check 5: "packages/db/owners.ts и тест на собствеността: всяка таблица, която packages/db изнася, има точно
// един модул собственик. Днес таблици няма и тестът минава; пробна таблица без собственик го прави червен."
// ADR-011 "Тест на собствеността": "packages/db/owners.ts казва модула собственик на всяка таблица. Таблица в схема app
// без собственик или с двама чупи CI."
//
// Contract assumed for owners.ts (the task names the file, not its shape): a named export `owners`, either
//   module -> its tables   { documents: ['documents', 'document_lines'], ... }   or
//   table  -> its module   { documents: 'documents', document_lines: 'documents', ... }.
// Tables are found in every entry point packages/db/package.json exports (ADR-011: "packages/db изнася таблиците на
// всеки модул отделно (@invoicely/db/documents)").
import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getTableName, is } from 'drizzle-orm';
import { PgTable, pgSchema, text } from 'drizzle-orm/pg-core';
import { owners } from './owners.js';

const pkgDir = dirname(fileURLToPath(import.meta.url));

// ADR-011 "Нивата и модулите" and the infrastructure that owns tables ("Притежава"): every table assigned there.
const ADR_011_OWNERS: Readonly<Record<string, readonly string[]>> = {
  workspaces: ['users', 'workspaces', 'workspace_members', 'invitations', 'company_access'],
  audit: ['audit_log'],
  files: ['files'],
  accounts: ['accounts', 'account_templates', 'categories', 'posting_rules', 'company_posting_rules', 'vat_treatments', 'parameters'],
  periods: ['periods', 'submissions', 'fiscal_years', 'holidays', 'deadline_rules'],
  companies: ['companies', 'vehicles', 'company_vat_regimes', 'company_transfers'],
  counterparties: ['counterparties', 'counterparty_ibans', 'vies_checks'],
  documents: ['documents', 'document_lines', 'document_kinds', 'products', 'ai_extractions', 'company_memory'],
  invoicing: ['number_sequences', 'issued_numbers'],
  posting: ['journal_entries', 'journal_lines', 'manual_entries', 'manual_entry_lines'],
  bank: ['bank_accounts', 'import_mappings', 'bank_statements', 'bank_transactions', 'payments', 'settlements'],
  vat: ['vat_returns', 'vat_refund_balances', 'vat_refund_uses', 'vat_credit_coefficients'],
  payroll: ['employees', 'employment_contracts', 'payroll_items'],
  tasks: ['deadlines', 'tasks', 'company_states'],
  checks: ['findings'],
  reports: [],
  onboarding: ['onboarding_imports', 'import_consents'],
  dashboard: [],
  'common/jobs': ['operations'],
  'common/idempotency': ['idempotency_keys'],
};
const KNOWN_OWNERS = new Set(Object.keys(ADR_011_OWNERS));

type Pair = { table: string; owner: string };

// Both shapes of owners.ts become (table, owner) pairs.
function ownerPairs(value: unknown): Pair[] {
  expect(typeof value === 'object' && value !== null && !Array.isArray(value), 'owners must be an object').toBe(true);
  const pairs: Pair[] = [];
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') pairs.push({ table: key, owner: v });
    else if (Array.isArray(v) && v.every((t) => typeof t === 'string')) for (const t of v) pairs.push({ table: t, owner: key });
    else throw new Error(`owners.${key} is neither a module name nor a list of table names`);
  }
  return pairs;
}

// The ownership check: every table has exactly one owner.
function ownershipErrors(tables: readonly string[], pairs: readonly Pair[]): string[] {
  const errors: string[] = [];
  for (const table of tables) {
    const found = [...new Set(pairs.filter((p) => p.table === table).map((p) => p.owner))];
    if (found.length === 0) errors.push(`table ${table} has no owner in owners.ts`);
    if (found.length > 1) errors.push(`table ${table} has ${found.length} owners: ${found.join(', ')}`);
  }
  return errors;
}

// The files behind packages/db's "exports" (or "main"), as on disk.
function entryFiles(): string[] {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { exports?: unknown; main?: string };
  const pick = (v: unknown): string | undefined => {
    if (typeof v === 'string') return v;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
    const o = v as Record<string, unknown>;
    for (const c of ['source', 'development', 'import', 'node', 'default', 'require']) {
      const r = pick(o[c]);
      if (r !== undefined) return r;
    }
    return undefined;
  };
  const targets: string[] = [];
  const ex = pkg.exports;
  if (ex === undefined) {
    targets.push(pkg.main ?? './src/index.ts');
  } else if (typeof ex === 'string' || Object.keys(ex as object).every((k) => !k.startsWith('.'))) {
    const t = pick(ex);
    if (t !== undefined) targets.push(t);
  } else {
    for (const [sub, v] of Object.entries(ex as Record<string, unknown>)) {
      if (sub === './package.json' || sub === './owners') continue;
      const t = pick(v);
      if (t === undefined || t.endsWith('.json')) continue;
      if (t.includes('*')) {
        const [before, rest] = t.split('*', 2) as [string, string];
        const dir = join(pkgDir, before);
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) {
          const candidate = `${before}${name}${rest}`;
          if (existsSync(join(pkgDir, candidate))) targets.push(candidate);
        }
      } else {
        targets.push(t);
      }
    }
  }
  return targets.map((t) => {
    const file = join(pkgDir, t);
    if (existsSync(file)) return file;
    const source = join(pkgDir, t.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts'));
    if (existsSync(source)) return source;
    throw new Error(`packages/db exports ${t}, which is not on disk`);
  });
}

async function exportedTables(): Promise<string[]> {
  const names = new Set<string>();
  for (const file of entryFiles()) {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const value of Object.values(mod)) if (is(value, PgTable)) names.add(getTableName(value));
  }
  return [...names].sort();
}

describe('check 5: every table packages/db exports has exactly one owner module', () => {
  test('check 5: every exported table has exactly one owner in owners.ts', async () => {
    const tables = await exportedTables();
    expect(ownershipErrors(tables, ownerPairs(owners))).toEqual([]); // check 5: "има точно един модул собственик"
  });

  test('check 5: today packages/db exports no tables', async () => {
    // Какво: "Бизнес логика и таблици още няма." The first task that adds a table replaces this test.
    expect(await exportedTables()).toEqual([]);
  });

  test('check 5: a probe table app.notes without an owner makes the ownership check red', () => {
    // check 5: "пробна таблица без собственик го прави червен"; ADR-011: "миграция добавя app.notes без ред в owners.ts:
    // CI спира PR-а"
    const notes = pgSchema('app').table('notes', { id: text('id').primaryKey() });
    expect(is(notes, PgTable)).toBe(true);
    const errors = ownershipErrors([getTableName(notes)], ownerPairs(owners));
    expect(errors).toEqual(['table notes has no owner in owners.ts']);
  });

  test('check 5: a probe table with two owners makes the ownership check red', () => {
    // ADR-011: "Таблица в схема app без собственик или с двама чупи CI."
    const pairs: Pair[] = [...ownerPairs(owners), { table: 'notes', owner: 'documents' }, { table: 'notes', owner: 'posting' }];
    expect(ownershipErrors(['notes'], pairs)).toEqual(['table notes has 2 owners: documents, posting']);
  });

  test('check 5: owners.ts names only owners from ADR-011, and gives each listed table the ADR-011 owner', () => {
    for (const { table, owner } of ownerPairs(owners)) {
      expect(KNOWN_OWNERS.has(owner), `owner "${owner}" of ${table} is not a module or table-owning folder in ADR-011`).toBe(true);
      const adrOwner = Object.entries(ADR_011_OWNERS).find(([, ts]) => ts.includes(table))?.[0];
      if (adrOwner !== undefined) expect(owner, `ADR-011: ${table} belongs to ${adrOwner}`).toBe(adrOwner);
    }
  });
});
