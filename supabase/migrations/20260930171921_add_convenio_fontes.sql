/*
# Controle de Convênios: 4 fontes orçamentárias + vínculo financeiro

## Changes
- `convenios`: adds numeric columns for the four budget sources
  (fonte_5 Convênio, fonte_45 Convênio Superávit, fonte_4 Contrapartida,
  fonte_44 Contrapartida Superávit) and `finance_account_id` linking the
  convenio to its financial bank account.
- Legacy `convenio_sources` rows are kept but the app no longer reads them.
*/

ALTER TABLE convenios
  ADD COLUMN IF NOT EXISTS fonte_5 numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fonte_45 numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fonte_4 numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fonte_44 numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finance_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;
