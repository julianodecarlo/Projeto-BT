import { supabase } from '@/lib/supabase';
import Decimal from 'decimal.js';
import type { Transaction } from '@/types';

interface AccountLike {
  id: string;
  saldo_inicial: number;
}

// Recalcula do ZERO a cadeia saldo_anterior → saldo_final de cada conta,
// ignorando os valores salvos no banco. A fórmula única é aplicada em cadeia:
// SALDO FINAL = SALDO ANTERIOR + ENTRADAS (repasses, transferências recebidas,
// depósitos, anulações, rendimentos) − SAÍDAS (colunas orçamentárias,
// transferências enviadas). O total acumulado é independente da ordem das
// linhas, então o resultado final é sempre consistente.
export async function forceRecalcBtSaldos(btId: string, accounts: AccountLike[]) {
  for (const acc of accounts) {
    const { data: txs, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('bt_report_id', btId)
      .eq('account_id', acc.id)
      .order('ordem', { ascending: true });
    if (error || !txs) continue;

    let saldo = new Decimal(acc.saldo_inicial || 0);
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
