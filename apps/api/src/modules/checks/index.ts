// checks (L3): owns findings; queues checks.run, checks.ai-review, checks.dead-letter; uses L0, L1, L2, tasks.
// Why: ADR-011 Модули и собственост на данните. Empty until the module's first task; import it only through this file.
export {};
