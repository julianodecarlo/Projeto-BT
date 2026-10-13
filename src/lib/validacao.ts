import { supabase } from './supabase';
import { formatCurrency, toDecimal } from './format';
import { getOpenItems, pendenciasPorConta, getReconStatus } from './reconStatus';
import type {
  BtReport,
  Account,
  Transaction,
  RevenueOwn,
  Cheque,
  DepositPending,
  PaymentPending,
  PendencyResolution,
  Reconciliation,
} from '@/types';

export interface PendenciaItem {
  location: string;
  message: string;
}

// FONTE ÚNICA DE VALIDAÇÃO DO BT (usada por Validar BT, Fechar BT e pelo
// Fechamento Diário). Retorna a lista de pendências impeditivas; lista vazia
// significa BT pronto para fechamento. Divergências em contas de convênio não
// impedem o fechamento (conciliação periódica).
export async function validarBtCentral(
  btId: string,
  accounts: Account[],
  reconciliations: Reconciliation[]
): Promise<PendenciaItem[]> {
  const [btRes, txRes, revRes, cqRes, dpRes, payRes, resRes, btsRes] = await Promise.all([
    supabase.from('bt_reports').select('*').eq('id', btId).maybeSingle(),
    supabase.from('transactions').select('*').eq('bt_report_id', btId).order('ordem', { ascending: true }),
    supabase.from('revenue_own').select('*').eq('bt_report_id', btId),
    supabase.from('cheques').select('*'),
    supabase.from('deposits_pending').select('*'),
    supabase.from('payments_pending').select('*'),
    supabase.from('pendency_resolutions').select('*'),
    supabase.from('bt_reports').select('id, data'),
  ]);
  const bt = btRes.data as BtReport | null;
  if (!bt) return [{ location: 'Sistema', message: 'BT não encontrado.' }];

  const transactions = (txRes.data || []) as Transaction[];
  const revenues = (revRes.data || []) as RevenueOwn[];

  const pendencias: PendenciaItem[] = [];

  if (transactions.length === 0) {
    pendencias.push({
      location: 'Movimentações',
      message: 'Nenhuma movimentação registrada no BT.',
    });
  }

  const balanceOk = transactions.every(t => {
    const expected = t.tipo_movimento === 'entrada'
      ? toDecimal(t.saldo_anterior).plus(toDecimal(t.valor)).toNumber()
      : toDecimal(t.saldo_anterior).minus(toDecimal(t.valor)).toNumber();
    return Math.abs(expected - t.saldo_final) < 0.01;
  });
  if (!balanceOk) {
    pendencias.push({
      location: 'Movimentações',
      message: 'Há inconsistência nos saldos corridos (saldo anterior + entrada − saída ≠ saldo final).',
    });
  }

  // FOTO ESTÁTICA POR BT: pendências criadas até o BT e não baixadas em/antes dele.
  const openItems = getOpenItems(
    {
      cheques: (cqRes.data || []) as Cheque[],
      deposits: (dpRes.data || []) as DepositPending[],
      payments: (payRes.data || []) as PaymentPending[],
      resolutions: (resRes.data || []) as PendencyResolution[],
    },
    { id: bt.id, data: bt.data },
    (btsRes.data || []) as Pick<BtReport, 'id' | 'data'>[]
  );
  const pendMap = pendenciasPorConta(openItems);

  const activeAccounts = accounts.filter(a => a.ativo);
  const isContaConvenio = (accountId: string) =>
    accounts.find(a => a.id === accountId)?.categoria === 'convenio';

  // SALDO FINAL ORÇAMENTÁRIO: âncora "Saldo Anterior" + entradas − saídas,
  // independentemente da ordem das linhas.
  const saldoOrcamentarioPorConta = (accId: string): number => {
    const acc = accounts.find(a => a.id === accId);
    const accTxs = transactions.filter(t => t.account_id === accId);
    if (!acc || accTxs.length === 0) return acc?.saldo_inicial ?? 0;
    const anchor = accTxs.find(t => t.descricao === 'Saldo Anterior');
    let saldo = toDecimal(anchor ? anchor.saldo_anterior : acc.saldo_inicial);
    for (const t of accTxs) {
      if (t.descricao === 'Saldo Anterior') continue;
      const v = toDecimal(t.valor);
      saldo = t.tipo_movimento === 'entrada' ? saldo.plus(v) : saldo.minus(v);
    }
    return saldo.toNumber();
  };

  const accountsWithTx = new Set(transactions.map(t => t.account_id));
  for (const acc of activeAccounts) {
    const status = getReconStatus(
      reconciliations.find(r => r.account_id === acc.id),
      pendMap.get(acc.id) ?? 0,
      saldoOrcamentarioPorConta(acc.id)
    );
    if (isContaConvenio(acc.id)) continue;

    if (status.divergente) {
      const dif = toDecimal(status.saldoConciliado)
        .minus(toDecimal(saldoOrcamentarioPorConta(acc.id)))
        .toNumber();
      pendencias.push({
        location: `Conciliação Bancária - Conta ${acc.nome ?? '—'}`,
        message: `Saldo com divergência de ${formatCurrency(dif)} entre Extrato e BT.`,
      });
    } else if (status.pendente && accountsWithTx.has(acc.id)) {
      pendencias.push({
        location: `Conciliação Bancária - Conta ${acc.nome}`,
        message: 'Conta com movimento no BT sem conciliação registrada.',
      });
    }
  }

  const hasContabil = revenues.some(r => r.tipo === 'contabil');
  const hasFinanceira = revenues.some(r => r.tipo === 'financeira');
  if (!hasContabil || !hasFinanceira) {
    pendencias.push({
      location: 'Controle da Receita',
      message: !hasContabil && !hasFinanceira
        ? 'Nenhuma receita própria registrada (contábil e financeira).'
        : !hasContabil
          ? 'Receitas Próprias Contábil não preenchidas.'
          : 'Receitas Próprias Financeira não preenchidas.',
    });
  }

  if (!bt.elaborado_por?.trim() || !bt.conferido_por?.trim()) {
    pendencias.push({
      location: 'Fechamento Diário',
      message: 'Assinaturas de elaboração e/ou conferência não preenchidas.',
    });
  }

  return pendencias;
}
