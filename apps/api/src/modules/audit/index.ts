// audit (L0): owns audit_log (written by a trigger); queue audit.partitions; uses nothing.
// Why: ADR-011 Модули и собственост на данните. Empty until the module's first task; import it only through this file.
export {};
