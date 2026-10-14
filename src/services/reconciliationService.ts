import { supabase } from '@/lib/supabase';
import type {
  BtReport,
  Cheque,
  DepositPending,
  PaymentPending,
  PendencyResolution,
  Reconciliation,
} from '@/types';

// Fonte única de pendências abertas por BT (foto estática) e status de conciliação.
export { getOpenItems, pendenciasPorConta, calcularStatusConciliacao } from '@/lib/reconStatus';
export { listConvenios } from '@/services/convenioService';

export interface PendencyData {
  cheques: Cheque[];
  deposits: DepositPending[];
  payments: PaymentPending[];
  resolutions: PendencyResolution[];
}

export async function fetchPendencyData(): Promise<PendencyData> {
  const [cqRes, dpRes, payRes, resRes] = await Promise.all([
    supabase.from('cheques').select('*').order('data_emissao', { ascending: true }),
    supabase.from('deposits_pending').select('*').order('created_at', { ascending: true }),
    supabase.from('payments_pending').select('*').order('created_at', { ascending: true }),
    supabase.from('pendency_resolutions').select('*'),
  ]);
  return {
    cheques: (cqRes.data || []) as Cheque[],
    deposits: (dpRes.data || []) as DepositPending[],
    payments: (payRes.data || []) as PaymentPending[],
    resolutions: (resRes.data || []) as PendencyResolution[],
  };
}

export async function listBtMeta(): Promise<Pick<BtReport, 'id' | 'data' | 'status'>[]> {
  const { data } = await supabase.from('bt_reports').select('id, data, status');
  return (data as Pick<BtReport, 'id' | 'data' | 'status'>[]) || [];
}

export async function fetchReconciliations(btId: string): Promise<Reconciliation[]> {
  const { data } = await supabase.from('reconciliation').select('*').eq('bt_report_id', btId);
  return (data as Reconciliation[]) || [];
}

export interface ReconInput {
  id?: string;
  btReportId: string;
  accountId: string;
  saldo_extrato: number;
  rendimento_acumulado: number;
  ajuste_arredondamento: number;
  saldo_conciliado: number;
  saldo_orcamentario: number;
  divergente: boolean;
}

// Grava a conciliação da conta (cria na primeira vez, atualiza depois).
export async function saveReconciliation(input: ReconInput): Promise<Reconciliation | null> {
  const payload = {
    saldo_extrato: input.saldo_extrato,
    rendimento_acumulado: input.rendimento_acumulado,
    ajuste_arredondamento: input.ajuste_arredondamento,
    saldo_conciliado: input.saldo_conciliado,
    saldo_orcamentario: input.saldo_orcamentario,
    divergente: input.divergente,
  };
  if (input.id) {
    const { data, error } = await supabase
      .from('reconciliation')
      .update(payload)
      .eq('id', input.id)
      .select()
      .single();
    return !error && data ? (data as Reconciliation) : null;
  }
  const { data, error } = await supabase
    .from('reconciliation')
    .insert({
      bt_report_id: input.btReportId,
      account_id: input.accountId,
      ...payload,
    })
    .select()
    .single();
  return !error && data ? (data as Reconciliation) : null;
}

// Registra a baixa de uma pendência no BT corrente e atualiza o status
// permanente do registro original para auditoria.
export async function resolvePendency(
  kind: 'cheque' | 'deposito' | 'pagamento',
  refId: string,
  btReportId: string
): Promise<PendencyResolution | null> {
  const { data, error } = await supabase
    .from('pendency_resolutions')
    .insert({ kind, ref_id: refId, bt_report_id: btReportId })
    .select()
    .single();
  if (error || !data) return null;
  const statusMap = { cheque: 'compensado', deposito: 'realizado', pagamento: 'pago' } as const;
  const tableMap = { cheque: 'cheques', deposito: 'deposits_pending', pagamento: 'payments_pending' } as const;
  await supabase.from(tableMap[kind]).update({ status: statusMap[kind] }).eq('id', refId);
  return data as PendencyResolution;
}

export async function addCheque(p: {
  bt_report_id: string;
  account_id: string;
  data_emissao: string;
  numero: string;
  valor: number;
  beneficiario: string;
  status: string;
}): Promise<Cheque | null> {
  const { data, error } = await supabase.from('cheques').insert(p).select().single();
  return !error && data ? (data as Cheque) : null;
}

export async function deleteCheque(id: string): Promise<void> {
  await supabase.from('cheques').delete().eq('id', id);
}

export async function addDeposit(p: {
  bt_report_id: string;
  account_id: string;
  valor: number;
  descricao: string | null;
}): Promise<DepositPending | null> {
  const { data, error } = await supabase.from('deposits_pending').insert(p).select().single();
  return !error && data ? (data as DepositPending) : null;
}

export async function deleteDeposit(id: string): Promise<void> {
  await supabase.from('deposits_pending').delete().eq('id', id);
}

export async function addPayment(p: {
  bt_report_id: string;
  account_id: string;
  valor: number;
  data_lancamento: string;
  descricao: string | null;
}): Promise<PaymentPending | null> {
  const { data, error } = await supabase.from('payments_pending').insert(p).select().single();
  return !error && data ? (data as PaymentPending) : null;
}

export async function deletePayment(id: string): Promise<void> {
  await supabase.from('payments_pending').delete().eq('id', id);
}
