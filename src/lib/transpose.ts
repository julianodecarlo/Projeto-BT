import { supabase } from './supabase';
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
  for (const acc of accounts) {
    const saldoInicial = previousBt
      ? await getSaldoFinalConta(previousBt, acc)
      : acc.saldo_inicial;

    await supabase.from('transactions').insert({
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

  // ---- Receita Própria: cria linhas de saldo anterior (contábil + financeira)
  const subalinhas = await fetchSubalinhas();
  for (const sub of subalinhas) {
    const nome = `${sub.codigo} - ${sub.descricao}`;
    const saldoAntContabil = previousBt
      ? await getSaldoFinalReceita(previousBt, nome, 'contabil')
      : 0;
    const saldoAntFinanceira = previousBt
      ? await getSaldoFinalReceita(previousBt, nome, 'financeira')
      : 0;

    const rows = [
      { tipo: 'contabil', saldo_anterior: saldoAntContabil, arrecadacao: 0, saldo_final_contabil: saldoAntContabil, caixa: 0, bancos: 0, saldo_final_financeiro: 0, account_id: null },
      { tipo: 'financeira', saldo_anterior: saldoAntFinanceira, arrecadacao: 0, saldo_final_contabil: 0, caixa: 0, bancos: 0, saldo_final_financeiro: saldoAntFinanceira, account_id: null },
    ];
    await supabase.from('revenue_own').insert(
      rows.map((r) => ({ ...r, bt_report_id: newBt.id, subalinea: nome, ordem: 0 }))
    );
  }

  // ---- Convênios: snapshot das fontes (saldo anterior = final do BT anterior)
  for (const conv of convenios) {
    const saldos = previousBt
      ? await getFontesFinal(previousBt, conv)
      : { fonte_5: conv.fonte_5, fonte_45: conv.fonte_45, fonte_4: conv.fonte_4, fonte_44: conv.fonte_44 };

    await supabase.from('bt_convenios').insert({
      bt_report_id: newBt.id,
      convenio_id: conv.id,
      fonte_5: saldos.fonte_5,
      fonte_45: saldos.fonte_45,
      fonte_4: saldos.fonte_4,
      fonte_44: saldos.fonte_44,
    });
  }
}

async function getPreviousBt(bt: BtReport): Promise<BtReport | null> {
  const { data } = await supabase
    .from('bt_reports')
    .select('*')
    .lt('data', bt.data)
    .order('data', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as BtReport) || null;
}

async function fetchAccounts(): Promise<Account[]> {
  const { data } = await supabase.from('accounts').select('*').order('ordem');
  return (data as Account[]) || [];
}

async function fetchConvenios(): Promise<Convenio[]> {
  const { data } = await supabase.from('convenios').select('*').order('nome');
  return (data as Convenio[]) || [];
}

async function fetchSubalinhas(): Promise<{ codigo: string; descricao: string }[]> {
  const { data } = await supabase.from('subalinhas').select('codigo, descricao').eq('ativo', true).order('ordem');
  return (data as { codigo: string; descricao: string }[]) || [];
}

async function getSaldoFinalConta(bt: BtReport, acc: Account): Promise<number> {
  // Última transação da conta no BT anterior carrega o saldo final
  const { data } = await supabase
    .from('transactions')
    .select('saldo_final')
    .eq('bt_report_id', bt.id)
    .eq('account_id', acc.id)
    .order('ordem', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) return (data as { saldo_final: number }).saldo_final;

  // Sem movimentações no BT anterior: o saldo "final" é o saldo anterior carregado
  const { data: abertura } = await supabase
    .from('transactions')
    .select('saldo_anterior')
    .eq('bt_report_id', bt.id)
    .eq('account_id', acc.id)
    .eq('descricao', 'Saldo Anterior')
    .maybeSingle();
  if (abertura) return (abertura as { saldo_anterior: number }).saldo_anterior;

  return acc.saldo_inicial;
}

async function getSaldoFinalReceita(bt: BtReport, subalinea: string, tipo: 'contabil' | 'financeira'): Promise<number> {
  const field = tipo === 'contabil' ? 'saldo_final_contabil' : 'saldo_final_financeiro';
  const { data } = await supabase
    .from('revenue_own')
    .select(field)
    .eq('bt_report_id', bt.id)
    .eq('subalinea', subalinea)
    .eq('tipo', tipo)
    .maybeSingle();
  if (data) return ((data as Record<string, number>)[field] as number) || 0;

  // Sem linha no BT anterior: carrega o saldo anterior da linha equivalente
  const { data: linha } = await supabase
    .from('revenue_own')
    .select('saldo_anterior')
    .eq('bt_report_id', bt.id)
    .eq('subalinea', subalinea)
    .eq('tipo', tipo)
    .maybeSingle();
  return linha ? ((linha as { saldo_anterior: number }).saldo_anterior || 0) : 0;
}

async function getFontesFinal(
  bt: BtReport,
  conv: Convenio
): Promise<{ fonte_5: number; fonte_45: number; fonte_4: number; fonte_44: number }> {
  const { data } = await supabase
    .from('bt_convenios')
    .select('fonte_5, fonte_45, fonte_4, fonte_44')
    .eq('bt_report_id', bt.id)
    .eq('convenio_id', conv.id)
    .maybeSingle();
  if (data) {
    return data as { fonte_5: number; fonte_45: number; fonte_4: number; fonte_44: number };
  }
  return { fonte_5: conv.fonte_5, fonte_45: conv.fonte_45, fonte_4: conv.fonte_4, fonte_44: conv.fonte_44 };
}
