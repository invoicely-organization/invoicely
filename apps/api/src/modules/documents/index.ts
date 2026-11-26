// documents (L1): owns documents, document_lines, document_kinds, products, ai_extractions, company_memory;
// queue documents.extract; uses L0, counterparties.
// Why: ADR-011 Модули и собственост на данните. Empty until the module's first task; import it only through this file.
export {};
