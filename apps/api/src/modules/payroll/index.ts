// payroll (L2): owns employees, employment_contracts, payroll_items; queues come with the payroll stage;
// uses L0, L1, posting.
// Why: ADR-011 Модули и собственост на данните. Empty until the module's first task; import it only through this file.
export {};
