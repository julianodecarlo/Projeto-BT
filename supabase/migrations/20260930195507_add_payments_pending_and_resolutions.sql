/*
# Add payments_pending and pendency_resolutions tables

## 1. Overview
Bank reconciliation pendecy management: cheques, deposits and (new) pending payments
must be resolvable per-BT without touching previous BTs or accounting balances.

## 2. New Tables
- `payments_pending`: pending payments
  - id, bt_report_id (BT where the payment was registered), account_id (conta corrente a debitar),
    valor, data_lancamento, descricao, created_at
- `pendency_resolutions`: per-BT settlement records ("baixa")
  - id, kind ('cheque' | 'deposito' | 'pagamento'), ref_id (row being settled),
    bt_report_id (BT where the baixa was given), created_at
  - The original rows are never updated, so earlier BTs keep their historical state.

## 3. Security
- RLS enabled on both tables; single-tenant (no sign-in), so policies use
  `TO anon, authenticated` with `USING (true)` — same as the rest of the schema.
*/

CREATE TABLE IF NOT EXISTS payments_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_report_id uuid REFERENCES bt_reports(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  data_lancamento date NOT NULL DEFAULT CURRENT_DATE,
  descricao text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE payments_pending ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_payments_pending" ON payments_pending;
CREATE POLICY "anon_select_payments_pending" ON payments_pending FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_payments_pending" ON payments_pending;
CREATE POLICY "anon_insert_payments_pending" ON payments_pending FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_payments_pending" ON payments_pending;
CREATE POLICY "anon_update_payments_pending" ON payments_pending FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_payments_pending" ON payments_pending;
CREATE POLICY "anon_delete_payments_pending" ON payments_pending FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS pendency_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  ref_id uuid NOT NULL,
  bt_report_id uuid NOT NULL REFERENCES bt_reports(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pendency_resolutions_ref
  ON pendency_resolutions (kind, ref_id);

ALTER TABLE pendency_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_pendency_resolutions" ON pendency_resolutions;
CREATE POLICY "anon_select_pendency_resolutions" ON pendency_resolutions FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_pendency_resolutions" ON pendency_resolutions;
CREATE POLICY "anon_insert_pendency_resolutions" ON pendency_resolutions FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_pendency_resolutions" ON pendency_resolutions;
CREATE POLICY "anon_update_pendency_resolutions" ON pendency_resolutions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_pendency_resolutions" ON pendency_resolutions;
CREATE POLICY "anon_delete_pendency_resolutions" ON pendency_resolutions FOR DELETE
  TO anon, authenticated USING (true);
