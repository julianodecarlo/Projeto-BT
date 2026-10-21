import { supabase } from '@/lib/supabase';
import type { RevenueOwn, Subalinea } from '@/types';

export async function listSubalinhas(): Promise<Subalinea[]> {
  const { data } = await supabase.from('subalinhas').select('*').order('ordem');
  return (data as Subalinea[]) || [];
}

export async function addSubalinea(p: {
  codigo: string;
  descricao: string;
  ordem: number;
  ativo: boolean;
}): Promise<Subalinea | null> {
  const { data, error } = await supabase.from('subalinhas').insert(p).select().single();
  return !error && data ? (data as Subalinea) : null;
}

export async function updateSubalinea(id: string, p: { codigo: string; descricao: string }): Promise<void> {
  await supabase.from('subalinhas').update(p).eq('id', id);
}

export async function deleteSubalinea(id: string): Promise<void> {
  await supabase.from('subalinhas').delete().eq('id', id);
}

export async function listRevenues(btId: string): Promise<RevenueOwn[]> {
  const { data } = await supabase
    .from('revenue_own')
    .select('*')
    .eq('bt_report_id', btId)
    .order('ordem', { ascending: true });
  return (data as RevenueOwn[]) || [];
}

export async function insertRevenueRows(rows: Record<string, unknown>[]): Promise<RevenueOwn[]> {
  const { data, error } = await supabase.from('revenue_own').insert(rows).select();
  return !error && data ? (data as RevenueOwn[]) : [];
}

export async function updateRevenue(
  id: string,
  payload: Partial<Pick<RevenueOwn, 'saldo_anterior' | 'arrecadacao' | 'saldo_final_contabil' | 'caixa' | 'bancos' | 'saldo_final_financeiro'>>
): Promise<RevenueOwn | null> {
  const { data, error } = await supabase.from('revenue_own').update(payload).eq('id', id).select().single();
  return !error && data ? (data as RevenueOwn) : null;
}

export async function deleteRevenue(id: string): Promise<void> {
  await supabase.from('revenue_own').delete().eq('id', id);
}
