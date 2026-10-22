import { supabase } from '@/lib/supabase';
import Decimal from 'decimal.js';
import type { Transaction } from '@/types';

interface AccountLike {
  id: string;
  saldo_inicial: number;
}

// Saldo final de uma conta em um BT, calculado de forma independente de ordem:
// âncora "Saldo Anterior" + somatório de entradas - somatório de saídas.
// Retorna null se a conta não possui nenhuma linha no BT.
export async function computeSaldoFinalConta(btId: string, acc: AccountLike): Promise<number | null> {
  const { data: txs } = await supabase
    .from('transactions')
    .select('*')
    .eq('bt_report_id', btId)
    .eq('account_id', acc.id);
  if (!txs || txs.length === 0) return null;

  const anchor = (txs as Transaction[]).find(t => t.descricao === 'Saldo Anterior');
  let saldo = new Decimal(anchor ? anchor.saldo_anterior || 0 : acc.saldo_inicial || 0);
  for (const t of txs as Transaction[]) {
    if (t.descricao === 'Saldo Anterior') continue;
    const v = new Decimal(t.valor || 0);
    saldo = t.tipo_movimento === 'entrada' ? saldo.plus(v) : saldo.minus(v);
  }
  return saldo.toNumber();
}

// BT imediatamente anterior a um dado BT (excluindo-o), por data e criação.
// ESTRITO: data estritamente menor que a do novo BT — nunca o próprio último
// BT do mesmo dia, que ainda não foi encerrado.
export async function getBtAnterior(bt: { id: string; data: string }): Promise<{ id: string; data: string } | null> {
  const { data } = await supabase
    .from('bt_reports')
    .select('id, data')
    .neq('id', bt.id)
    .lt('data', bt.data)
    .order('data', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; data: string }) || null;
}

// Regra estrita de abertura: saldo final do BT N-1; o cadastro só vale no primeiro BT.
export async function getSaldoAbertura(bt: { id: string; data: string }, acc: AccountLike): Promise<number> {
  const prev = await getBtAnterior(bt);
  if (!prev) return acc.saldo_inicial || 0;
  const fin = await computeSaldoFinalConta(prev.id, acc);
  return fin !== null ? fin : (acc.saldo_inicial || 0);
}

// Recalcula do ZERO a cadeia saldo_anterior → saldo_final de cada conta,
// ignorando os valores salvos no banco. A fórmula única é aplicada em cadeia:
// SALDO FINAL = SALDO ANTERIOR + ENTRADAS (repasses, transferências recebidas,
// depósitos, anulações, rendimentos) − SAÍDAS (colunas orçamentárias,
// transferências enviadas). A abertura vem do saldo final do BT anterior.
export async function forceRecalcBtSaldos(bt: { id: string; data: string }, accounts: AccountLike[]) {
  for (const acc of accounts) {
    const { data: txs, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('bt_report_id', bt.id)
      .eq('account_id', acc.id)
      .order('ordem', { ascending: true });
    if (error || !txs) continue;

    let saldo = new Decimal(await getSaldoAbertura(bt, acc));
    for (const raw of txs as Transaction[]) {
      // Normaliza anulações antigas gravadas como saída: anulação é estorno e SEMPRE credita
      if (raw.tipo === 'deposito_anulacao' && raw.tipo_movimento === 'saida') {
        await supabase.from('transactions').update({ tipo_movimento: 'entrada' }).eq('id', raw.id);
        raw.tipo_movimento = 'entrada';
      }

      if (raw.descricao === 'Saldo Anterior') {
        if (raw.saldo_anterior !== saldo.toNumber() || raw.saldo_final !== saldo.toNumber()) {
          await supabase.from('transactions')
            .update({ saldo_anterior: saldo.toNumber(), saldo_final: saldo.toNumber() })
            .eq('id', raw.id);
        }
        continue;
      }

      const valor = new Decimal(raw.valor || 0);
      const fin = raw.tipo_movimento === 'entrada'
        ? saldo.plus(valor)
        : saldo.minus(valor);

      if (raw.saldo_anterior !== saldo.toNumber() || raw.saldo_final !== fin.toNumber()) {
        await supabase.from('transactions')
          .update({ saldo_anterior: saldo.toNumber(), saldo_final: fin.toNumber() })
          .eq('id', raw.id);
      }
      saldo = fin;
    }
  }
}
