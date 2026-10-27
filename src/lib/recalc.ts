import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetchAll';
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
  let txs: Transaction[];
  try {
    txs = await fetchAll<Transaction>((from, to) =>
      supabase
        .from('transactions')
        .select('*')
        .eq('bt_report_id', btId)
        .eq('account_id', acc.id)
        .order('id')
        .range(from, to)
    );
  } catch {
    return null;
  }
  if (txs.length === 0) return null;

  const anchor = txs.find(t => t.descricao === 'Saldo Anterior');
  let saldo = new Decimal(anchor ? anchor.saldo_anterior || 0 : acc.saldo_inicial || 0);
  for (const t of txs) {
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

// Tamanho dos lotes de UPDATE executados em paralelo (Promise.all).
const UPDATE_BATCH = 50;

// Recalcula do ZERO a cadeia saldo_anterior → saldo_final de cada conta,
// ignorando os valores salvos no banco. A fórmula única é aplicada em cadeia:
// SALDO FINAL = SALDO ANTERIOR + ENTRADAS (repasses, transferências recebidas,
// depósitos, anulações, rendimentos) − SAÍDAS (colunas orçamentárias,
// transferências enviadas). A abertura vem do saldo final do BT anterior.
export async function forceRecalcBtSaldos(bt: { id: string; data: string }, accounts: AccountLike[]) {
  // BT anterior calculado UMA vez por chamada (não por conta)
  const prev = await getBtAnterior(bt);

  // Transações do BT e do BT anterior em uma consulta cada (todas as contas)
  let btRes: Transaction[];
  try {
    btRes = await fetchAll<Transaction>((from, to) =>
      supabase
        .from('transactions')
        .select('*')
        .eq('bt_report_id', bt.id)
        .order('ordem', { ascending: true })
        .order('id')
        .range(from, to)
    );
  } catch {
    return;
  }

  let prevRows: Transaction[] = [];
  if (prev) {
    try {
      prevRows = await fetchAll<Transaction>((from, to) =>
        supabase
          .from('transactions')
          .select('*')
          .eq('bt_report_id', prev.id)
          .order('id')
          .range(from, to)
      );
    } catch {
      return;
    }
  }

  const txsByAcc = new Map<string, Transaction[]>();
  for (const raw of btRes) {
    const list = txsByAcc.get(raw.account_id) ?? [];
    list.push(raw);
    txsByAcc.set(raw.account_id, list);
  }
  const prevByAcc = new Map<string, Transaction[]>();
  for (const raw of prevRows) {
    const list = prevByAcc.get(raw.account_id) ?? [];
    list.push(raw);
    prevByAcc.set(raw.account_id, list);
  }

  const normalizeIds: string[] = [];
  const saldoUpdates: { id: string; saldo_anterior: number; saldo_final: number }[] = [];

  for (const acc of accounts) {
    const txs = txsByAcc.get(acc.id);
    if (!txs) continue;

    // Abertura = saldo final do BT anterior (mesma regra de getSaldoAbertura,
    // calculada em memória a partir das transações já buscadas); sem BT anterior
    // ou sem linhas no BT anterior, cai no saldo_inicial do cadastro.
    let abertura = acc.saldo_inicial || 0;
    const prevTxs = prev ? prevByAcc.get(acc.id) : undefined;
    if (prev && prevTxs && prevTxs.length > 0) {
      const anchor = prevTxs.find(t => t.descricao === 'Saldo Anterior');
      let saldoPrev = new Decimal(anchor ? anchor.saldo_anterior || 0 : acc.saldo_inicial || 0);
      for (const t of prevTxs) {
        if (t.descricao === 'Saldo Anterior') continue;
        const v = new Decimal(t.valor || 0);
        saldoPrev = t.tipo_movimento === 'entrada' ? saldoPrev.plus(v) : saldoPrev.minus(v);
      }
      abertura = saldoPrev.toNumber();
    }

    let saldo = new Decimal(abertura);
    for (const raw of txs) {
      // Normaliza anulações antigas gravadas como saída: anulação é estorno e SEMPRE credita
      if (raw.tipo === 'deposito_anulacao' && raw.tipo_movimento === 'saida') {
        normalizeIds.push(raw.id);
        raw.tipo_movimento = 'entrada';
      }

      if (raw.descricao === 'Saldo Anterior') {
        if (raw.saldo_anterior !== saldo.toNumber() || raw.saldo_final !== saldo.toNumber()) {
          saldoUpdates.push({ id: raw.id, saldo_anterior: saldo.toNumber(), saldo_final: saldo.toNumber() });
        }
        continue;
      }

      const valor = new Decimal(raw.valor || 0);
      const fin = raw.tipo_movimento === 'entrada'
        ? saldo.plus(valor)
        : saldo.minus(valor);

      if (raw.saldo_anterior !== saldo.toNumber() || raw.saldo_final !== fin.toNumber()) {
        saldoUpdates.push({ id: raw.id, saldo_anterior: saldo.toNumber(), saldo_final: fin.toNumber() });
      }
      saldo = fin;
    }
  }

  // UPDATEs apenas onde o valor diferir, executados em lotes com Promise.all
  const tasks: (() => PromiseLike<unknown>)[] = [
    ...normalizeIds.map(id => () =>
      supabase.from('transactions').update({ tipo_movimento: 'entrada' }).eq('id', id)),
    ...saldoUpdates.map(u => () =>
      supabase.from('transactions')
        .update({ saldo_anterior: u.saldo_anterior, saldo_final: u.saldo_final })
        .eq('id', u.id)),
  ];
  for (let i = 0; i < tasks.length; i += UPDATE_BATCH) {
    await Promise.all(tasks.slice(i, i + UPDATE_BATCH).map(run => run()));
  }
}
