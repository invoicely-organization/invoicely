// vat (L2): owns vat_returns, vat_refund_balances, vat_refund_uses, vat_credit_coefficients; queue vat.export;
// uses L0, L1, bank.
// Why: ADR-011 Модули и собственост на данните. Empty until the module's first task; import it only through this file.
export {};
