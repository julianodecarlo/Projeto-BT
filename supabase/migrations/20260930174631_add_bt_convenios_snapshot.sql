/*
# Snapshot de fontes de convênio por BT (transposição de saldos)

## Changes
- New table `bt_convenios`: per-BT snapshot of each convenio's four fontes,
  so Saldo Anterior(BT N) = Saldo Final(BT N-1) is persisted and cascade
  recalcs keep the timeline intact.
*/

CREATE TABLE IF NOT EXISTS bt_convenios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_report_id uuid NOT NULL REFERENCES bt_reports(id) ON DELETE CASCADE,
  convenio_id uuid NOT NULL REFERENCES convenios(id) ON DELETE CASCADE,
  fonte_5 numeric(14,2) NOT NULL DEFAULT 0,
  fonte_45 numeric(14,2) NOT NULL DEFAULT 0,
  fonte_4 numeric(14,2) NOT NULL DEFAULT 0,
  fonte_44 numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (bt_report_id, convenio_id)
);

ALTER TABLE bt_convenios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_bt_convenios" ON bt_convenios;
CREATE POLICY "anon_select_bt_convenios" ON bt_convenios FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_bt_convenios" ON bt_convenios;
CREATE POLICY "anon_insert_bt_convenios" ON bt_convenios FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_bt_convenios" ON bt_convenios;
CREATE POLICY "anon_update_bt_convenios" ON bt_convenios FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_bt_convenios" ON bt_convenios;
CREATE POLICY "anon_delete_bt_convenios" ON bt_convenios FOR DELETE
  TO anon, authenticated USING (true);
