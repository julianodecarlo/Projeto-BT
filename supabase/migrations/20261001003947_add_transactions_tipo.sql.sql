/*
# Support financial transfers between accounts

1. Modified Tables
- `transactions`: add optional `tipo` (text) column marking special entries:
  - `repasse_reitoria` — repasse financeiro recebido da Reitoria (credita Conta Tesouro)
  - `transf_tesouro_receita` — Tesouro -> Receita
  - `transf_tesouro_diarias` — Tesouro -> Diárias
  - `transf_livre` — transferência livre entre contas
  Existing rows keep `tipo = null` and are unaffected. Nullable, no data migration needed.

2. Security
- No RLS changes: the table already has policies applied by earlier migrations.

3. Notes
- Column addition is idempotent via DO block.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'tipo'
  ) THEN
    ALTER TABLE transactions ADD COLUMN tipo text;
  END IF;
END $$;