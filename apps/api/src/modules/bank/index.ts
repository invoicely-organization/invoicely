// bank (L2): owns bank_accounts, import_mappings, bank_statements, bank_transactions, payments, settlements;
// queue bank.import; uses L0, L1, posting.
// Why: ADR-011 Модули и собственост на данните. Empty until the module's first task; import it only through this file.
export {};
