/*
# Add subalíneas table for Receita Própria

## Overview
Creates a table to store the official list of subalíneas (revenue sub-line items)
used in Receita Própria (Contábil and Financeira) tables. Pre-populated with the
official list provided by the accounting team.

## New Table
- `subalinhas` - stores revenue sub-line codes and descriptions
  - id, codigo (e.g. "0121.03.00"), descricao (e.g. "Emendas Estaduais")
  - ativo (boolean), ordem (int), created_at

## Security
- RLS enabled, single-tenant open policies (TO anon, authenticated)
*/

CREATE TABLE IF NOT EXISTS subalinhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  descricao text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE subalinhas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_subalinhas" ON subalinhas;
CREATE POLICY "anon_select_subalinhas" ON subalinhas FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_subalinhas" ON subalinhas;
CREATE POLICY "anon_insert_subalinhas" ON subalinhas FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_subalinhas" ON subalinhas;
CREATE POLICY "anon_update_subalinhas" ON subalinhas FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_subalinhas" ON subalinhas;
CREATE POLICY "anon_delete_subalinhas" ON subalinhas FOR DELETE
  TO anon, authenticated USING (true);

-- Seed official subalíneas
INSERT INTO subalinhas (codigo, descricao, ordem) VALUES
  ('0121.03.00', 'Emendas Estaduais', 1),
  ('0121.05.00', 'Transferências Voluntárias do Estado', 2),
  ('1311.99.01', 'Outras Receitas de Aluguéis do Estado', 3),
  ('1325.01.01', 'Fundo de Investimento Financeiro-Fif-Tes', 4),
  ('1325.01.06', 'Outras Aplicações Financeiras', 5),
  ('1600.99.01', 'Outros Serviços do Estado', 6),
  ('1730.01.01', 'Doações de Instituições Diversas do Estado', 7),
  ('1750.01.01', 'Doações de Pessoas Físicas', 8),
  ('1761.99.01', 'Outras Transferências de Convênios da União', 9),
  ('1919.50.01', 'Multas Por Infração do Regul -Diversos Dep. Estado', 10),
  ('1922.99.02', 'Outras restituições do Estado', 11),
  ('1990.99.01', 'Outras Receitas Não Discriminadas do Estado', 12),
  ('1990.99.01x', 'Cancelamento de Restos a Pagar', 13),
  ('2219.02.01', 'Venda de Outros Bens Patrimoniais do Estado', 14),
  ('2471.99.01', 'Outras Transferências de Convênio da União', 15)
ON CONFLICT DO NOTHING;
