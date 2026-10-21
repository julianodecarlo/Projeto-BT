import { supabase } from './supabase';
import { getOpenItems } from './reconStatus';
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
  const [accountsRes, txRes, revRes, cqRes, dpRes, payRes, resRes, btsRes, reconRes] = await Promise.all([
    supabase.from('accounts').select('*').order('ordem'),
    supabase.from('transactions').select('*').eq('bt_report_id', btId).order('ordem'),
    supabase.from('revenue_own').select('*').eq('bt_report_id', btId).order('ordem'),
    supabase.from('cheques').select('*'),
    supabase.from('deposits_pending').select('*'),
    supabase.from('payments_pending').select('*'),
    supabase.from('pendency_resolutions').select('*'),
    supabase.from('bt_reports').select('id, data'),
    supabase.from('reconciliation').select('*').eq('bt_report_id', btId),
  ]);
  // Mesma FOTO ESTÁTICA POR BT da aba Conciliação: pendências criadas até o BT
  // e não baixadas em/antes dele.
  const openItems = getOpenItems(
    {
      cheques: (cqRes.data || []) as Cheque[],
      deposits: (dpRes.data || []) as DepositPending[],
      payments: (payRes.data || []) as PaymentPending[],
      resolutions: (resRes.data || []) as PendencyResolution[],
    },
    { id: (bt as BtReport).id, data: (bt as BtReport).data },
    (btsRes.data || []) as Pick<BtReport, 'id' | 'data'>[]
  );
  return {
    bt: bt as BtReport,
    accounts: (accountsRes.data || []) as Account[],
    transactions: (txRes.data || []) as Transaction[],
    revenues: (revRes.data || []) as RevenueOwn[],
    cheques: openItems.cheques,
    deposits: openItems.deposits,
    payments: openItems.payments,
    reconciliations: (reconRes.data || []) as Reconciliation[],
  };
}

export async function fetchValidacaoData(
  btId: string,
  accounts: Account[],
  reconciliations: Reconciliation[]
): Promise<ValidacaoData | null> {
  const { data: bt } = await supabase.from('bt_reports').select('*').eq('id', btId).maybeSingle();
  if (!bt) return null;
  const [txRes, revRes, cqRes, dpRes, payRes, resRes, btsRes] = await Promise.all([
    supabase.from('transactions').select('*').eq('bt_report_id', btId).order('ordem', { ascending: true }),
    supabase.from('revenue_own').select('*').eq('bt_report_id', btId),
    supabase.from('cheques').select('*'),
    supabase.from('deposits_pending').select('*'),
    supabase.from('payments_pending').select('*'),
    supabase.from('pendency_resolutions').select('*'),
    supabase.from('bt_reports').select('id, data'),
  ]);
  return {
    bt: bt as BtReport,
    accounts,
    transactions: (txRes.data || []) as Transaction[],
    revenues: (revRes.data || []) as RevenueOwn[],
    cheques: (cqRes.data || []) as Cheque[],
    deposits: (dpRes.data || []) as DepositPending[],
    payments: (payRes.data || []) as PaymentPending[],
    resolutions: (resRes.data || []) as PendencyResolution[],
    allBts: (btsRes.data || []) as Pick<BtReport, 'id' | 'data'>[],
    reconciliations,
  };
}
