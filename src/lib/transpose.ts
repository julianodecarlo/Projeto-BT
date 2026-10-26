import { supabase } from './supabase';
import { getSaldoAbertura, getBtAnterior } from './recalc';
import { sortAccounts } from './sortAccounts';
import type { Account, BtReport, Convenio } from '@/types';

/*
 * Transposição de saldos (regra da continuidade):
 * Saldo Inicial/Anterior(BT N) = Saldo Final(BT N-1) para todas as entidades.
 * No primeiro BT, usa o Saldo de Abertura/Cadastro.
 *
 * Persistência: os saldos de contas ficam gravados nas transactions
 * (saldo_anterior/saldo_final) e nas revenue_own (saldo_anterior); os saldos
 * das fontes de convênio ficam gravados na tabela bt_convenios (snapshot por BT).
 */

export async function transposeSaldos(newBt: BtReport): Promise<void> {
  const previousBt = await getPreviousBt(newBt);
  const accounts = await fetchAccounts();
  const convenios = await fetchConvenios();

  // ---- Contas bancárias: cria transação "Saldo Anterior" com o saldo carregado
  const accRows: Record<string, unknown>[] = [];
  for (const acc of accounts) {
    const saldoInicial = await getSaldoAbertura(newBt, acc);
    accRows.push({
      bt_report_id: newBt.id,
      account_id: acc.id,
      descricao: 'Saldo Anterior',
      tipo_orcamento: null,
      tipo_movimento: 'entrada',
      valor: 0,
      saldo_anterior: saldoInicial,
      saldo_final: saldoInicial,
      data_lancamento: newBt.data,
      ordem: 0,
    });
  }
  if (accRows.length > 0) {
    await supabase.from('transactions').insert(accRows);
  }

  // ---- Receita Própria: cria linhas de saldo anterior (contábil + financeira)
  // Saldos do BT anterior pré-buscados em lote (evita 1 consulta por subalínea)
  const subalinhas = await fetchSubalinhas();
  const prevReceita = previousBt ? await fetchPrevReceitaSaldos(previousBt) : null;
  const revRows: Record<string, unknown>[] = [];
  for (const sub of subalinhas) {
    const nome = `${sub.codigo} - ${sub.descricao}`;
    const saldoAntContabil = prevReceita
      ? prevReceita.receitaPorNome.get(`${nome}|contabil`) ?? 0
      : 0;
    const saldoAntFinanceira = prevReceita
      ? prevReceita.receitaPorNome.get(`${nome}|financeira`) ?? 0
      : 0;

    const rows = [
      { tipo: 'contabil', saldo_anterior: saldoAntContabil, arrecadacao: 0, saldo_final_contabil: saldoAntContabil, caixa: 0, bancos: 0, saldo_final_financeiro: 0, account_id: null },
      { tipo: 'financeira', saldo_anterior: saldoAntFinanceira, arrecadacao: 0, saldo_final_contabil: 0, caixa: 0, bancos: 0, saldo_final_financeiro: saldoAntFinanceira, account_id: null },
    ];
    for (const r of rows) {
      revRows.push({ ...r, bt_report_id: newBt.id, subalinea: nome, ordem: 0 });
    }
  }
  if (revRows.length > 0) {
    await supabase.from('revenue_own').insert(revRows);
  }

  // ---- Convênios: snapshot das fontes (saldo anterior = final do BT anterior)
  // Saldos do BT anterior pré-buscados em lote (evita 1 consulta por convênio)
  const prevConvenios = previousBt ? await fetchPrevConvenioSaldos(previousBt) : null;
  const convRows: Record<string, unknown>[] = [];
  for (const conv of convenios) {
    const saldos = previousBt
      ? prevConvenios?.convenioPorId.get(conv.id) ?? { fonte_5: conv.fonte_5, fonte_45: conv.fonte_45, fonte_4: conv.fonte_4, fonte_44: conv.fonte_44 }
      : { fonte_5: conv.fonte_5, fonte_45: conv.fonte_45, fonte_4: conv.fonte_4, fonte_44: conv.fonte_44 };

    convRows.push({
      bt_report_id: newBt.id,
      convenio_id: conv.id,
      fonte_5: saldos.fonte_5,
      fonte_45: saldos.fonte_45,
      fonte_4: saldos.fonte_4,
      fonte_44: saldos.fonte_44,
    });
  }
  if (convRows.length > 0) {
    await supabase.from('bt_convenios').insert(convRows);
  }
}

async function getPreviousBt(bt: BtReport): Promise<BtReport | null> {
  const prev = await getBtAnterior(bt);
  if (!prev) return null;
  const { data } = await supabase.from('bt_reports').select('*').eq('id', prev.id).maybeSingle();
  return (data as BtReport) || null;
}

async function fetchAccounts(): Promise<Account[]> {
  const { data } = await supabase.from('accounts').select('*').order('ordem');
  return sortAccounts((data as Account[]) || []);
}

async function fetchConvenios(): Promise<Convenio[]> {
  const { data } = await supabase.from('convenios').select('*').order('nome');
  return (data as Convenio[]) || [];
}

async function fetchSubalinhas(): Promise<{ codigo: string; descricao: string }[]> {
  const { data } = await supabase.from('subalinhas').select('codigo, descricao').eq('ativo', true).order('ordem');
  return (data as { codigo: string; descricao: string }[]) || [];
}

// Pré-busca em lote dos saldos do BT anterior para receita própria.
// Reproduz getSaldoFinalReceita: usa saldo_final_<tipo> se a linha existir,
// senão o saldo_anterior da linha; se não há linha nenhuma, 0.
async function fetchPrevReceitaSaldos(bt: BtReport): Promise<{ receitaPorNome: Map<string, number> }> {
  const receitaPorNome = new Map<string, number>();
  const { data } = await supabase
    .from('revenue_own')
    .select('subalinea, tipo, saldo_anterior, saldo_final_contabil, saldo_final_financeiro')
    .eq('bt_report_id', bt.id);
  const rows = (data || []) as { subalinea: string; tipo: string; saldo_anterior: number | null; saldo_final_contabil: number | null; saldo_final_financeiro: number | null }[];
  // Mantém a primeira linha por (subalinea, tipo), como o maybeSingle original
  for (const r of rows) {
    const key = `${r.subalinea}|${r.tipo}`;
    if (receitaPorNome.has(key)) continue;
    const isContabil = r.tipo === 'contabil';
    const fin = isContabil ? r.saldo_final_contabil : r.saldo_final_financeiro;
    receitaPorNome.set(key, fin != null ? fin || 0 : r.saldo_anterior || 0);
  }
  return { receitaPorNome };
}

// Pré-busca em lote dos saldos das fontes de convênio do BT anterior.
// Reproduz getFontesFinal: usa o snapshot da tabela bt_convenios se existir,
// senão o cadastro do convênio.
async function fetchPrevConvenioSaldos(bt: BtReport): Promise<{ convenioPorId: Map<string, { fonte_5: number; fonte_45: number; fonte_4: number; fonte_44: number }> }> {
  const convenioPorId = new Map<string, { fonte_5: number; fonte_45: number; fonte_4: number; fonte_44: number }>();
  const { data } = await supabase
    .from('bt_convenios')
    .select('convenio_id, fonte_5, fonte_45, fonte_4, fonte_44')
    .eq('bt_report_id', bt.id);
  for (const r of (data || []) as { convenio_id: string; fonte_5: number; fonte_45: number; fonte_4: number; fonte_44: number }[]) {
    if (!convenioPorId.has(r.convenio_id)) {
      convenioPorId.set(r.convenio_id, {
        fonte_5: r.fonte_5,
        fonte_45: r.fonte_45,
        fonte_4: r.fonte_4,
        fonte_44: r.fonte_44,
      });
    }
  }
  return { convenioPorId };
}
