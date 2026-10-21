/*
# Add fonte_orcamentaria to transactions

1. Modified Tables
- `transactions`
  - New column `fonte_orcamentaria` (text, nullable): identifies the budget
    source (fonte orçamentária) of a Depósito/Anulação launched against a
    Convênio account. Allowed values: 'fonte_5', 'fonte_45', 'fonte_4',
    'fonte_44'. Null for all other transaction types (budget columns,
    repasses, transfers, non-convenio deposits).

2. Security
- No RLS changes: the table already exists with its policies; the new nullable
  column inherits the existing access model.

3. Notes
- Nullable on purpose: historical rows and non-convenio entries keep null.
- Idempotent: guarded by information_schema check.
*/
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name = 'fonte_orcamentaria'
  ) THEN
    ALTER TABLE public.transactions
      ADD COLUMN fonte_orcamentaria text
      CHECK (fonte_orcamentaria IN ('fonte_5', 'fonte_45', 'fonte_4', 'fonte_44'));
  END IF;
END $$;
