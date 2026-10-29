-- Aba informativa "Entradas e Repasses": UMA linha por BT, somente conferência.
-- Não afeta saldos, transações nem validação/fechamento.

CREATE TABLE IF NOT EXISTS bt_entradas_repasses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_report_id uuid UNIQUE NOT NULL REFERENCES bt_reports(id) ON DELETE CASCADE,
  inf_total_pagamentos numeric(14,2) NOT NULL DEFAULT 0,
  inf_rp_tesouro numeric(14,2) NOT NULL DEFAULT 0,
  inf_rp_convenio numeric(14,2) NOT NULL DEFAULT 0,
  inf_rp_receita numeric(14,2) NOT NULL DEFAULT 0,
  inf_dc_tesouro numeric(14,2) NOT NULL DEFAULT 0,
  inf_dc_convenio numeric(14,2) NOT NULL DEFAULT 0,
  inf_dc_receita numeric(14,2) NOT NULL DEFAULT 0,
  inf_anulacoes numeric(14,2) NOT NULL DEFAULT 0,
  contabeis_novo_vigente numeric(14,2) NOT NULL DEFAULT 0,
  contabeis_novo_restos numeric(14,2) NOT NULL DEFAULT 0,
  contabeis_novo_diversos numeric(14,2) NOT NULL DEFAULT 0,
  ajuste_total_pagamentos numeric(14,2) NOT NULL DEFAULT 0,
  ajuste_anulacoes numeric(14,2) NOT NULL DEFAULT 0,
  observacao text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bt_entradas_repasses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bt_entradas_repasses' AND policyname = 'select_all_bt_entradas_repasses') THEN
    CREATE POLICY "select_all_bt_entradas_repasses" ON bt_entradas_repasses
      FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bt_entradas_repasses' AND policyname = 'insert_all_bt_entradas_repasses') THEN
    CREATE POLICY "insert_all_bt_entradas_repasses" ON bt_entradas_repasses
      FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bt_entradas_repasses' AND policyname = 'update_all_bt_entradas_repasses') THEN
    CREATE POLICY "update_all_bt_entradas_repasses" ON bt_entradas_repasses
      FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bt_entradas_repasses' AND policyname = 'delete_all_bt_entradas_repasses') THEN
    CREATE POLICY "delete_all_bt_entradas_repasses" ON bt_entradas_repasses
      FOR DELETE TO anon, authenticated USING (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON bt_entradas_repasses TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_bt_entradas_repasses_bt ON bt_entradas_repasses(bt_report_id);
