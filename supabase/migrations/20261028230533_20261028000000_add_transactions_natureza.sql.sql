/*
# Add natureza column to transactions (deposito | anulacao)

1. Modified Tables
- `transactions`: new nullable text column `natureza` with CHECK constraint
  allowing only 'deposito' or 'anulacao' (or NULL).
2. Backfill
- Only rows where tipo = 'deposito_anulacao' AND natureza IS NULL are filled:
  'anulacao' when lower(descricao) contains 'anula', otherwise 'deposito'.
  No other rows, values, saldos or tipo_movimento are touched.
3. Security
- No RLS changes. Column inherits existing table privileges; explicit GRANTs
  below keep UPDATE on the new column available to the app roles.
4. Idempotency
- ADD COLUMN IF NOT EXISTS + conditional UPDATE make this migration safe to
  re-run.
*/

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS natureza text NULL
  CHECK (natureza IN ('deposito', 'anulacao'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'natureza'
  ) THEN
    UPDATE transactions
    SET natureza = CASE
      WHEN lower(coalesce(descricao, '')) LIKE '%anula%' THEN 'anulacao'
      ELSE 'deposito'
    END
    WHERE tipo = 'deposito_anulacao' AND natureza IS NULL;
  END IF;
END $$;

GRANT UPDATE (natureza) ON transactions TO anon, authenticated;
GRANT INSERT (natureza) ON transactions TO anon, authenticated;