// The owner of every table in schema `app`: module (or table-owning infrastructure folder) -> its tables.
// Only the owner writes a table; others read through its queries and write through its service.
// A table packages/db exports without exactly one owner here fails owners.test.ts, and so CI.
// A new table first goes into ADR-011, then here, then into the schema.
// Why: ADR-011 Модули и собственост на данните.
export const owners = {
  // L0
  workspaces: ['users', 'workspaces', 'workspace_members', 'invitations', 'company_access'],
  audit: ['audit_log'],
  files: ['files'],
  accounts: ['accounts', 'account_templates', 'categories', 'posting_rules', 'company_posting_rules', 'vat_treatments', 'parameters'],
  periods: ['periods', 'submissions', 'fiscal_years', 'holidays', 'deadline_rules'],
  companies: ['companies', 'vehicles', 'company_vat_regimes', 'company_transfers'],
  // L1
  counterparties: ['counterparties', 'counterparty_ibans', 'vies_checks'],
  documents: ['documents', 'document_lines', 'document_kinds', 'products', 'ai_extractions', 'company_memory'],
  invoicing: ['number_sequences', 'issued_numbers'],
  // L2
  posting: ['journal_entries', 'journal_lines', 'manual_entries', 'manual_entry_lines'],
  bank: ['bank_accounts', 'import_mappings', 'bank_statements', 'bank_transactions', 'payments', 'settlements'],
  vat: ['vat_returns', 'vat_refund_balances', 'vat_refund_uses', 'vat_credit_coefficients'],
  payroll: ['employees', 'employment_contracts', 'payroll_items'],
  // L3
  tasks: ['deadlines', 'tasks', 'company_states'],
  checks: ['findings'],
  reports: [],
  onboarding: ['onboarding_imports', 'import_consents'],
  dashboard: [],
  // Infrastructure (apps/api/src/common)
  'common/jobs': ['operations'],
  'common/idempotency': ['idempotency_keys'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type Owner = keyof typeof owners;
