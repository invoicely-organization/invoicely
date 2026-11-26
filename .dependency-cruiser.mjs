// Import boundaries, run by `pnpm lint` (lint:deps).
// Packages: ADR-002 Backend и API, "1. Пакети". Modules in apps/api: ADR-011 Модули и собственост на данните.
// The module table below is the data of ADR-011 "Нивата и модулите"; change the ADR first, then this table.

const MODULES_DIR = '^apps/api/src/modules';

// level: L0..L3. alsoUses: the same-level modules from ADR-011's "Ползва още" column.
const MODULES = {
  workspaces: { level: 0, alsoUses: [] },
  audit: { level: 0, alsoUses: [] },
  files: { level: 0, alsoUses: [] },
  accounts: { level: 0, alsoUses: [] },
  periods: { level: 0, alsoUses: [] },
  companies: { level: 0, alsoUses: ['accounts'] },
  counterparties: { level: 1, alsoUses: [] },
  documents: { level: 1, alsoUses: ['counterparties'] },
  invoicing: { level: 1, alsoUses: ['counterparties', 'documents'] },
  posting: { level: 2, alsoUses: [] },
  bank: { level: 2, alsoUses: ['posting'] },
  vat: { level: 2, alsoUses: ['bank'] },
  payroll: { level: 2, alsoUses: ['posting'] },
  tasks: { level: 3, alsoUses: [] },
  checks: { level: 3, alsoUses: ['tasks'] },
  reports: { level: 3, alsoUses: [] },
  onboarding: { level: 3, alsoUses: [] },
  dashboard: { level: 3, alsoUses: ['tasks'] },
};

// ADR-011: every other module uses workspaces (the access guard) and audit; workspaces uses only audit; audit uses
// nothing.
function allowedFor(name) {
  if (name === 'audit') return [];
  if (name === 'workspaces') return ['audit'];
  const { level, alsoUses } = MODULES[name];
  const lower = Object.keys(MODULES).filter((m) => MODULES[m].level < level);
  return [...new Set(['workspaces', 'audit', ...lower, ...alsoUses])];
}

const moduleLevelRules = Object.keys(MODULES).map((name) => {
  const allowed = [name, ...allowedFor(name)];
  return {
    name: `module-uses-${name}`,
    comment: `${name} (L${MODULES[name].level}) may use only: ${allowedFor(name).join(', ') || 'nothing'}. ADR-011 "Нивата и модулите".`,
    severity: 'error',
    from: { path: `${MODULES_DIR}/${name}/` },
    to: { path: `${MODULES_DIR}/`, pathNot: `${MODULES_DIR}/(${allowed.join('|')})/` },
  };
});

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'No cycles between packages, modules or files. ADR-002 "1. Пакети", ADR-011.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'module-through-index',
      comment: 'A module imports another module only through its index.ts. ADR-011 "Как се проверява".',
      severity: 'error',
      from: { path: `${MODULES_DIR}/([^/]+)/` },
      to: { path: `${MODULES_DIR}/[^/]+/`, pathNot: [`${MODULES_DIR}/$1/`, `${MODULES_DIR}/[^/]+/index\\.ts$`] },
    },
    ...moduleLevelRules,
    {
      name: 'common-not-to-modules',
      comment: 'Infrastructure (common/) does not import modules. ADR-011.',
      severity: 'error',
      from: { path: '^apps/api/src/common/' },
      to: { path: `${MODULES_DIR}/` },
    },
    {
      name: 'shared-imports-none-of-ours',
      comment: 'packages/shared imports nothing of ours. ADR-002 "1. Пакети".',
      severity: 'error',
      from: { path: '^packages/shared/' },
      to: { path: '^(packages/(domain|db)|apps)/' },
    },
    {
      name: 'domain-imports-only-shared',
      comment: 'packages/domain imports only packages/shared. ADR-002 "1. Пакети".',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: { path: '^(packages/db|apps)/' },
    },
    {
      name: 'db-imports-only-shared',
      comment: 'packages/db imports only packages/shared. ADR-002 "1. Пакети".',
      severity: 'error',
      from: { path: '^packages/db/' },
      to: { path: '^(packages/domain|apps)/' },
    },
    {
      name: 'web-imports-only-shared',
      comment: 'apps/web imports only packages/shared: money and rules stay in the api. ADR-002 "1. Пакети", ADR-001.',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^(packages/(domain|db)|apps/api)/' },
    },
    {
      name: 'packages-not-to-apps',
      comment: 'Packages never import an app. ADR-002 "1. Пакети".',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist)/' },
    tsPreCompilationDeps: true,
    // The workspace packages expose their sources through "exports" (for example "./src/index.ts").
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
