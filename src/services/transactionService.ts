import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetchAll';
import { sortTxRows } from '@/lib/txOrder';
import { toDecimal } from '@/lib/format';
import type { Transaction, FonteOrcamentaria } from '@/types';

export async function listTransactions(btId: string): Promise<Transaction[]> {
  try {
    const rows = await fetchAll<Transaction>((from, to) =>
      supabase
        .from('transactions')
        .select('*')
        .eq('bt_report_id', btId)
        .range(from, to)
    );
    return sortTxRows(rows);
  } catch {
    return [];
  }
}

export async function listAccountTransactions(btId: string, accId: string): Promise<Transaction[]> {
  try {
    const rows = await fetchAll<Transaction>((from, to) =>
      supabase
        .from('transactions')
        .select('*')
        .eq('bt_report_id', btId)
        .eq('account_id', accId)
        .range(from, to)
    );
    return sortTxRows(rows);
  } catch {
    return [];
  }
}

// Último saldo corrente da conta no BT (null se a conta não tem linhas ainda).
export async function fetchLastSaldoFinal(btId: string, accId: string): Promise<number | null> {
  const rows = await fetchAll<Pick<Transaction, 'saldo_final'>>((from, to) =>
    supabase
      .from('transactions')
      .select('saldo_final')
      .eq('bt_report_id', btId)
      .eq('account_id', accId)
      .range(from, to)
  );
  if (rows.length === 0) return null;
  const sorted = sortTxRows(rows as Transaction[]);
  return (sorted[sorted.length - 1] as { saldo_final: number }).saldo_final;
}

// Próxima ordem única crescente para a conta no BT (max + 1); 1 se não há linhas.
export async function fetchNextOrdem(btId: string, accId: string): Promise<number> {
  const { data } = await supabase
    .from('transactions')
    .select('ordem')
    .eq('bt_report_id', btId)
    .eq('account_id', accId)
    .order('ordem', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? ((data as { ordem: number }).ordem ?? 0) + 1 : 1;
}

export async function fetchAccountSaldoInicial(accId: string): Promise<number> {
  const { data } = await supabase
    .from('accounts')
    .select('saldo_inicial')
    .eq('id', accId)
    .maybeSingle();
  return (data as { saldo_inicial: number } | null)?.saldo_inicial ?? 0;
}

// Saldo corrente = última linha do BT no período ou, na ausência, o saldo de cadastro.
async function currentSaldo(btId: string, accId: string): Promise<number> {
  const last = await fetchLastSaldoFinal(btId, accId);
  return last !== null ? last : fetchAccountSaldoInicial(accId);
}

export interface NewEntry {
  btReportId: string;
  accountId: string;
  descricao: string;
  valor: number;
  dataLancamento: string;
  tipoMovimento: 'entrada' | 'saida';
  tipo?: string | null;
  tipoOrcamento?: string | null;
  fonteOrcamentaria?: FonteOrcamentaria | null;
  natureza?: 'deposito' | 'anulacao' | null;
  ordem?: number | null;
  // Quando a cadeia de saldos já é conhecida (lançamentos orçamentários), os
  // saldos vêm prontos; por padrão são derivados do saldo corrente da conta.
  saldoAnterior?: number | null;
  saldoFinal?: number | null;
  // Preserva uma ordem calculada pelo chamador (ex.: par de transferência).
  ordemFornecida?: boolean;
}

// Insere um lançamento aplicando SALDO FINAL = SALDO ANTERIOR ± VALOR.
export async function insertEntry(e: NewEntry): Promise<boolean> {
  try {
    const saldoAnt = e.saldoAnterior ?? (await currentSaldo(e.btReportId, e.accountId));
    const saldoFin =
      e.saldoFinal ??
      (e.tipoMovimento === 'entrada'
        ? toDecimal(saldoAnt).plus(e.valor)
        : toDecimal(saldoAnt).minus(e.valor)
      ).toNumber();
    // Monta o payload omitindo propriedades ausentes: enviar null/undefined
    // para colunas NOT NULL (ex.: ordem, data_lancamento) anula o valor padrão
    // do banco e rejeita o insert com erro de constraint.
    const payload: Record<string, unknown> = {
      bt_report_id: e.btReportId,
      account_id: e.accountId,
      descricao: e.descricao,
      tipo_movimento: e.tipoMovimento,
      valor: e.valor,
      saldo_anterior: saldoAnt,
      saldo_final: saldoFin,
    };
    if (e.dataLancamento) payload.data_lancamento = e.dataLancamento;
    if (e.tipo) payload.tipo = e.tipo;
    if (e.tipoOrcamento) payload.tipo_orcamento = e.tipoOrcamento;
    if (e.fonteOrcamentaria) payload.fonte_orcamentaria = e.fonteOrcamentaria;
    if (e.natureza) payload.natureza = e.natureza;
    // ordem única crescente por conta no BT: se o chamador não forneceu, deriva max+1
    if (e.ordem != null && e.ordemFornecida) {
      payload.ordem = e.ordem;
    } else {
      payload.ordem = await fetchNextOrdem(e.btReportId, e.accountId);
    }
    const { data, error } = (await supabase.from('transactions').insert(payload)
      .select(e.natureza ? 'id, natureza' : 'id')) as { data: Record<string, unknown>[] | null; error: { message: string } | null };
    if (error) {
      console.error('Erro ao salvar movimentação:', error.message || error);
      return false;
    }
    if (!data || data.length === 0) {
      console.error('Erro ao salvar movimentação: 0 linhas inseridas.');
      return false;
    }
    // Proibido falhar em silêncio: compara a natureza gravada com a escolhida.
    if (e.natureza && (data[0].natureza as string | null) !== e.natureza) {
      console.error(`Natureza gravada divergente: esperado ${e.natureza}, gravado ${String(data[0].natureza)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Erro ao salvar movimentação:', error);
    return false;
  }
}

export async function updateTransaction(
  id: string,
  fields: Partial<Pick<Transaction, 'valor' | 'descricao' | 'data_lancamento' | 'saldo_anterior' | 'saldo_final' | 'tipo_movimento' | 'fonte_orcamentaria' | 'natureza'>>
): Promise<boolean> {
  try {
    // .select() no retorno: 0 linhas afetadas é falha, não sucesso silencioso.
    const { data, error } = (await supabase
      .from('transactions')
      .update(fields)
      .eq('id', id)
      .select(fields.natureza !== undefined ? 'id, natureza' : 'id')) as { data: Record<string, unknown>[] | null; error: { message: string } | null };
    if (error) {
      console.error('Erro ao atualizar movimentação:', error.message || error);
      return false;
    }
    if (!data || data.length === 0) {
      console.error('Erro ao atualizar movimentação: 0 linhas afetadas.');
      return false;
    }
    if (fields.natureza !== undefined && (data[0].natureza as string | null) !== fields.natureza) {
      console.error(`Natureza gravada divergente: esperado ${fields.natureza}, gravado ${String(data[0].natureza)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Erro ao atualizar movimentação:', error);
    return false;
  }
}

export async function deleteTransaction(id: string): Promise<boolean> {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) console.error('Erro ao excluir movimentação:', error.message || error);
  return !error;
}

export async function deleteTransactions(ids: string[]): Promise<boolean> {
  const { error } = await supabase.from('transactions').delete().in('id', ids);
  if (error) console.error('Erro ao excluir movimentações:', error.message || error);
  return !error;
}

// Par de transferência: saída na origem + entrada no destino. Repasse da
// Reitoria envia apenas para a conta destino (fromId nulo).
export async function insertTransferPair(params: {
  btReportId: string;
  dataLancamento: string;
  tipo: 'repasse_reitoria' | 'transf_livre';
  fromId: string | null;
  toId: string | null;
  valor: number;
  descricao: string;
}): Promise<boolean> {
  if (params.valor <= 0) return false;

  if (!params.fromId && params.toId) {
    return insertEntry({
      btReportId: params.btReportId,
      accountId: params.toId,
      descricao: params.descricao,
      valor: params.valor,
      dataLancamento: params.dataLancamento,
      tipoMovimento: 'entrada',
      tipo: params.tipo,
    });
  }

  if (!params.fromId || !params.toId) return false;

  const okFrom = await insertEntry({
    btReportId: params.btReportId,
    accountId: params.fromId,
    descricao: params.descricao,
    valor: params.valor,
    dataLancamento: params.dataLancamento,
    tipoMovimento: 'saida',
    tipo: params.tipo,
  });
  if (!okFrom) return false;

  return insertEntry({
    btReportId: params.btReportId,
    accountId: params.toId,
    descricao: params.descricao,
    valor: params.valor,
    dataLancamento: params.dataLancamento,
    tipoMovimento: 'entrada',
    tipo: params.tipo,
  });
}

// Recria a cadeia saldo_anterior → saldo_final de uma conta a partir da âncora
// "Saldo Anterior" (ou do saldo de cadastro, na ausência).
export async function recalcAccountSaldos(btId: string, accId: string, saldoInicial: number): Promise<void> {
  const rows = await listAccountTransactions(btId, accId);
  const opening = rows.find(t => t.descricao === 'Saldo Anterior');
  let saldo = toDecimal(opening ? opening.saldo_anterior : saldoInicial);
  for (const tx of rows) {
    if (tx.descricao === 'Saldo Anterior') continue;
    const fin = tx.tipo_movimento === 'entrada'
      ? saldo.plus(toDecimal(tx.valor))
      : saldo.minus(toDecimal(tx.valor));
    if (tx.saldo_anterior !== saldo.toNumber() || tx.saldo_final !== fin.toNumber()) {
      await updateTransaction(tx.id, { saldo_anterior: saldo.toNumber(), saldo_final: fin.toNumber() });
    }
    saldo = fin;
  }
}
