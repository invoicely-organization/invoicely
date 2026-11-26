// posting (L2): owns journal_entries, journal_lines, manual_entries, manual_entry_lines; queue posting.batch-book;
// uses L0, L1. The only module that writes journal entries.
// Why: ADR-011 Модули и собственост на данните. Empty until the module's first task; import it only through this file.
export {};
