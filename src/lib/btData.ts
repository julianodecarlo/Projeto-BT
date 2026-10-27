import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import { getOpenItems } from './reconStatus';
import { sortAccounts } from './sortAccounts';
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

// Dados consolidados de um BT para a geração do PDF.
export interface PdfData {
  bt: BtReport;
  accounts: Account[];
  transactions: Transaction[];
  revenues: RevenueOwn[];
  cheques: Cheque[];
  deposits: DepositPending[];
  payments: PaymentPending[];
  reconciliations: Reconciliation[];
}

// Dados consolidados de um BT para a validação central.
export interface ValidacaoData extends PdfData {
  resolutions: PendencyResolution[];
  allBts: Pick<BtReport, 'id' | 'data'>[];
}

// Camada única de consulta: busca e consolida tudo que as funções puras
// (validacao.ts / pdf.ts) precisam. Nenhuma outra função toca no banco.
export async function fetchPdfData(btId: string): Promise<PdfData | null> {
  const { data: bt } = await supabase.from('bt_reports').select('*').eq('id', btId).maybeSingle();
  if (!bt) return null;
  let all: [Account[], Transaction[], RevenueOwn[], Cheque[], DepositPending[], PaymentPending[], PendencyResolution[], Pick<BtReport, 'id' | 'data'>[], Reconciliation[]];
  try {
    all = await Promise.all([
    fetchAll<Account>((from, to) => supabase.from('accounts').select('*').order('ordem').order('id').range(from, to)),
    fetchAll<Transaction>((from, to) =>
      supabase.from('transactions').select('*').eq('bt_report_id', btId).order('ordem').order('id').range(from, to)),
    fetchAll<RevenueOwn>((from, to) =>
      supabase.from('revenue_own').select('*').eq('bt_report_id', btId).order('ordem').order('id').range(from, to)),
    fetchAll<Cheque>((from, to) =>
      supabase.from('cheques').select('id, bt_report_id, account_id, data_emissao, numero, valor, beneficiario').order('id').range(from, to)),
    fetchAll<DepositPending>((from, to) =>
      supabase.from('deposits_pending').select('id, bt_report_id, account_id, valor, descricao').order('id').range(from, to)),
    fetchAll<PaymentPending>((from, to) =>
      supabase.from('payments_pending').select('id, bt_report_id, account_id, valor').order('id').range(from, to)),
    fetchAll<PendencyResolution>((from, to) =>
      supabase.from('pendency_resolutions').select('id, kind, ref_id, bt_report_id').order('id').range(from, to)),
    fetchAll<Pick<BtReport, 'id' | 'data'>>((from, to) =>
      supabase.from('bt_reports').select('id, data').order('id').range(from, to)),
    fetchAll<Reconciliation>((from, to) =>
      supabase.from('reconciliation').select('*').eq('bt_report_id', btId).order('id').range(from, to)),
    ]);
  } catch {
    return null;
  }
  const [accountsRes, txRes, revRes, cqRes, dpRes, payRes, resRes, btsRes, reconRes] = all;
  // Mesma FOTO ESTÁTICA POR BT da aba Conciliação: pendências criadas até o BT
  // e não baixadas em/antes dele.
  const openItems = getOpenItems(
    {
      cheques: cqRes,
      deposits: dpRes,
      payments: payRes,
      resolutions: resRes,
    },
    { id: (bt as BtReport).id, data: (bt as BtReport).data },
    btsRes
  );
  return {
    bt: bt as BtReport,
    accounts: sortAccounts(accountsRes),
    transactions: txRes,
    revenues: revRes,
    cheques: openItems.cheques,
    deposits: openItems.deposits,
    payments: openItems.payments,
    reconciliations: reconRes,
  };
}

export async function fetchValidacaoData(
  btId: string,
  accounts: Account[],
  reconciliations: Reconciliation[]
): Promise<ValidacaoData | null> {
  const { data: bt } = await supabase.from('bt_reports').select('*').eq('id', btId).maybeSingle();
  if (!bt) return null;
  let all2: [Transaction[], RevenueOwn[], Cheque[], DepositPending[], PaymentPending[], PendencyResolution[], Pick<BtReport, 'id' | 'data'>[]];
  try {
    all2 = await Promise.all([
    fetchAll<Transaction>((from, to) =>
      supabase.from('transactions').select('*').eq('bt_report_id', btId).order('ordem', { ascending: true }).order('id').range(from, to)),
    fetchAll<RevenueOwn>((from, to) =>
      supabase.from('revenue_own').select('*').eq('bt_report_id', btId).order('id').range(from, to)),
    fetchAll<Cheque>((from, to) =>
      supabase.from('cheques').select('id, bt_report_id, account_id, data_emissao, numero, valor, beneficiario').order('id').range(from, to)),
    fetchAll<DepositPending>((from, to) =>
      supabase.from('deposits_pending').select('id, bt_report_id, account_id, valor, descricao').order('id').range(from, to)),
    fetchAll<PaymentPending>((from, to) =>
      supabase.from('payments_pending').select('id, bt_report_id, account_id, valor').order('id').range(from, to)),
    fetchAll<PendencyResolution>((from, to) =>
      supabase.from('pendency_resolutions').select('id, kind, ref_id, bt_report_id').order('id').range(from, to)),
    fetchAll<Pick<BtReport, 'id' | 'data'>>((from, to) =>
      supabase.from('bt_reports').select('id, data').order('id').range(from, to)),
    ]);
  } catch {
    return null;
  }
  const [txRes, revRes, cqRes, dpRes, payRes, resRes, btsRes] = all2;
  return {
    bt: bt as BtReport,
    accounts,
    transactions: txRes,
    revenues: revRes,
    cheques: cqRes,
    deposits: dpRes,
    payments: payRes,
    resolutions: resRes,
    allBts: btsRes,
    reconciliations,
  };
}
