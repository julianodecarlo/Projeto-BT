/*
# Create BT (Boletim de Tesouraria) Schema

## Overview
This migration creates the complete database schema for the BT (Boletim de Tesouraria) application,
a daily financial control system for treasury management.

## New Tables

1. **bt_reports** - Daily BT reports (one per day)
   - id, numero (BT number), data (movement date), status (rascunho/validado/fechado)
   - Institution info, signature fields (elaborado/conferido por)

2. **accounts** - Dynamic bank accounts (user can create/delete)
   - id, nome, categoria (movimento/receita/diarias/convenio/caucao/deposito_judicial)
   - codigo, ativo, ordem, saldo_inicial

3. **convenios** - Convention entities
   - id, nome, account_id (link to accounts table)

4. **convenio_sources** - Source lines within conventions
   - id, convenio_id, tipo (convenio=5/45 or receita=4/44)
   - codigo_vigente, codigo_superavit

5. **transactions** - Individual payment/entry transactions
   - id, bt_report_id, account_id, descricao
   - tipo_orcamento (vigente/restos_pagar/diversos_credores)
   - tipo_movimento (entrada/saida), valor, saldo_anterior, saldo_final

6. **revenue_own** - Receitas Próprias entries (contábil 3-col and financeira 4-col)
   - id, bt_report_id, subalinea, tipo (contabil/financeira)
   - Contábil: saldo_anterior, arrecadacao, saldo_final_contabil
   - Financeira: saldo_anterior, caixa, bancos, saldo_final_financeiro, account_id

7. **cheques** - Cheques emitted (a compensar / compensado)
   - id, bt_report_id, account_id, data_emissao, numero, valor, beneficiario, status

8. **deposits_pending** - Pending/unidentified deposits per account
   - id, bt_report_id, account_id, valor, descricao

9. **reconciliation** - Bank reconciliation per account per BT
   - id, bt_report_id, account_id, saldo_extrato, rendimento_acumulado
   - saldo_conciliado, saldo_orcamentario, divergente

## Security
- RLS enabled on all tables
- Single-tenant (no auth): all policies use `TO anon, authenticated` with `USING (true)`
  because the data is intentionally shared/public (no sign-in screen)
*/

-- ==================== BT REPORTS ====================
CREATE TABLE IF NOT EXISTS bt_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL,
  data date NOT NULL,
  status text NOT NULL DEFAULT 'rascunho',
  instituicao text DEFAULT 'UNIVERSIDADE ESTADUAL PAULISTA - CAMPUS DE BOTUCATU',
  unidade text DEFAULT 'INSTITUTO DE BIOCIÊNCIAS CÂMPUS DE BOTUCATU - RECEITA PRÓPRIA',
  elaborado_por text,
  cargo_elaborado text,
  conferido_por text,
  cargo_conferido text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bt_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_bt_reports" ON bt_reports;
CREATE POLICY "anon_select_bt_reports" ON bt_reports FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_bt_reports" ON bt_reports;
CREATE POLICY "anon_insert_bt_reports" ON bt_reports FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_bt_reports" ON bt_reports;
CREATE POLICY "anon_update_bt_reports" ON bt_reports FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_bt_reports" ON bt_reports;
CREATE POLICY "anon_delete_bt_reports" ON bt_reports FOR DELETE
  TO anon, authenticated USING (true);

-- ==================== ACCOUNTS ====================
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  categoria text NOT NULL,
  codigo text,
  ativo boolean NOT NULL DEFAULT true,
  ordem int NOT NULL DEFAULT 0,
  saldo_inicial numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_accounts" ON accounts;
CREATE POLICY "anon_select_accounts" ON accounts FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_accounts" ON accounts;
CREATE POLICY "anon_insert_accounts" ON accounts FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_accounts" ON accounts;
CREATE POLICY "anon_update_accounts" ON accounts FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_accounts" ON accounts;
CREATE POLICY "anon_delete_accounts" ON accounts FOR DELETE
  TO anon, authenticated USING (true);

-- ==================== CONVENIOS ====================
CREATE TABLE IF NOT EXISTS convenios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE convenios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_convenios" ON convenios;
CREATE POLICY "anon_select_convenios" ON convenios FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_convenios" ON convenios;
CREATE POLICY "anon_insert_convenios" ON convenios FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_convenios" ON convenios;
CREATE POLICY "anon_update_convenios" ON convenios FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_convenios" ON convenios;
CREATE POLICY "anon_delete_convenios" ON convenios FOR DELETE
  TO anon, authenticated USING (true);

-- ==================== CONVENIO SOURCES ====================
CREATE TABLE IF NOT EXISTS convenio_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  convenio_id uuid NOT NULL REFERENCES convenios(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  codigo_vigente text NOT NULL,
  codigo_superavit text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE convenio_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_convenio_sources" ON convenio_sources;
CREATE POLICY "anon_select_convenio_sources" ON convenio_sources FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_convenio_sources" ON convenio_sources;
CREATE POLICY "anon_insert_convenio_sources" ON convenio_sources FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_convenio_sources" ON convenio_sources;
CREATE POLICY "anon_update_convenio_sources" ON convenio_sources FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_convenio_sources" ON convenio_sources;
CREATE POLICY "anon_delete_convenio_sources" ON convenio_sources FOR DELETE
  TO anon, authenticated USING (true);

-- ==================== TRANSACTIONS ====================
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_report_id uuid NOT NULL REFERENCES bt_reports(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  descricao text NOT NULL,
  tipo_orcamento text,
  tipo_movimento text NOT NULL,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  saldo_anterior numeric(14,2) NOT NULL DEFAULT 0,
  saldo_final numeric(14,2) NOT NULL DEFAULT 0,
  data_lancamento date,
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_transactions" ON transactions;
CREATE POLICY "anon_select_transactions" ON transactions FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_transactions" ON transactions;
CREATE POLICY "anon_insert_transactions" ON transactions FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_transactions" ON transactions;
CREATE POLICY "anon_update_transactions" ON transactions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_transactions" ON transactions;
CREATE POLICY "anon_delete_transactions" ON transactions FOR DELETE
  TO anon, authenticated USING (true);

-- ==================== REVENUE OWN (RP) ====================
CREATE TABLE IF NOT EXISTS revenue_own (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_report_id uuid NOT NULL REFERENCES bt_reports(id) ON DELETE CASCADE,
  subalinea text NOT NULL,
  tipo text NOT NULL,
  saldo_anterior numeric(14,2) NOT NULL DEFAULT 0,
  arrecadacao numeric(14,2) NOT NULL DEFAULT 0,
  saldo_final_contabil numeric(14,2) NOT NULL DEFAULT 0,
  caixa numeric(14,2) NOT NULL DEFAULT 0,
  bancos numeric(14,2) NOT NULL DEFAULT 0,
  saldo_final_financeiro numeric(14,2) NOT NULL DEFAULT 0,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE revenue_own ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_revenue_own" ON revenue_own;
CREATE POLICY "anon_select_revenue_own" ON revenue_own FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_revenue_own" ON revenue_own;
CREATE POLICY "anon_insert_revenue_own" ON revenue_own FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_revenue_own" ON revenue_own;
CREATE POLICY "anon_update_revenue_own" ON revenue_own FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_revenue_own" ON revenue_own;
CREATE POLICY "anon_delete_revenue_own" ON revenue_own FOR DELETE
  TO anon, authenticated USING (true);

-- ==================== CHEQUES ====================
CREATE TABLE IF NOT EXISTS cheques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_report_id uuid REFERENCES bt_reports(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  data_emissao date NOT NULL,
  numero text NOT NULL,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  beneficiario text NOT NULL,
  status text NOT NULL DEFAULT 'a_compensar',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cheques ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_cheques" ON cheques;
CREATE POLICY "anon_select_cheques" ON cheques FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_cheques" ON cheques;
CREATE POLICY "anon_insert_cheques" ON cheques FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_cheques" ON cheques;
CREATE POLICY "anon_update_cheques" ON cheques FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_cheques" ON cheques;
CREATE POLICY "anon_delete_cheques" ON cheques FOR DELETE
  TO anon, authenticated USING (true);

-- ==================== DEPOSITS PENDING ====================
CREATE TABLE IF NOT EXISTS deposits_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_report_id uuid REFERENCES bt_reports(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  descricao text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE deposits_pending ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_deposits_pending" ON deposits_pending;
CREATE POLICY "anon_select_deposits_pending" ON deposits_pending FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_deposits_pending" ON deposits_pending;
CREATE POLICY "anon_insert_deposits_pending" ON deposits_pending FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_deposits_pending" ON deposits_pending;
CREATE POLICY "anon_update_deposits_pending" ON deposits_pending FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_deposits_pending" ON deposits_pending;
CREATE POLICY "anon_delete_deposits_pending" ON deposits_pending FOR DELETE
  TO anon, authenticated USING (true);

-- ==================== RECONCILIATION ====================
CREATE TABLE IF NOT EXISTS reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_report_id uuid NOT NULL REFERENCES bt_reports(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  saldo_extrato numeric(14,2) NOT NULL DEFAULT 0,
  rendimento_acumulado numeric(14,2) NOT NULL DEFAULT 0,
  saldo_conciliado numeric(14,2) NOT NULL DEFAULT 0,
  saldo_orcamentario numeric(14,2) NOT NULL DEFAULT 0,
  divergente boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(bt_report_id, account_id)
);

ALTER TABLE reconciliation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_reconciliation" ON reconciliation;
CREATE POLICY "anon_select_reconciliation" ON reconciliation FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_reconciliation" ON reconciliation;
CREATE POLICY "anon_insert_reconciliation" ON reconciliation FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_reconciliation" ON reconciliation;
CREATE POLICY "anon_update_reconciliation" ON reconciliation FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_reconciliation" ON reconciliation;
CREATE POLICY "anon_delete_reconciliation" ON reconciliation FOR DELETE
  TO anon, authenticated USING (true);

-- ==================== INDEXES ====================
CREATE INDEX IF NOT EXISTS idx_transactions_bt_report ON transactions(bt_report_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_revenue_own_bt_report ON revenue_own(bt_report_id);
CREATE INDEX IF NOT EXISTS idx_cheques_bt_report ON cheques(bt_report_id);
CREATE INDEX IF NOT EXISTS idx_cheques_account ON cheques(account_id);
CREATE INDEX IF NOT EXISTS idx_deposits_bt_report ON deposits_pending(bt_report_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_bt_report ON reconciliation(bt_report_id);
CREATE INDEX IF NOT EXISTS idx_convenio_sources_convenio ON convenio_sources(convenio_id);
