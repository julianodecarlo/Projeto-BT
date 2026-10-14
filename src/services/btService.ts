import { supabase } from '@/lib/supabase';
import type { BtReport, Account } from '@/types';

export async function listAccounts(): Promise<Account[]> {
  const { data } = await supabase.from('accounts').select('*').order('ordem', { ascending: true });
  return (data as Account[]) || [];
}

export async function fetchBt(btId: string): Promise<BtReport | null> {
  const { data } = await supabase.from('bt_reports').select('*').eq('id', btId).maybeSingle();
  return (data as BtReport) || null;
}

export async function fetchLatestBt(): Promise<BtReport | null> {
  const { data } = await supabase
    .from('bt_reports')
    .select('*')
    .order('data', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as BtReport) || null;
}

export async function listBts(): Promise<BtReport[]> {
  const { data } = await supabase.from('bt_reports').select('*').order('data', { ascending: false });
  return (data as BtReport[]) || [];
}

export async function listRecentBts(limit: number): Promise<BtReport[]> {
  const { data } = await supabase
    .from('bt_reports')
    .select('*')
    .order('data', { ascending: false })
    .limit(limit);
  return (data as BtReport[]) || [];
}

// Cadeia de recálculo em cascata: todos os BTs de data igual ou posterior.
export async function listBtsFromData(data: string): Promise<BtReport[]> {
  const { data: rows } = await supabase
    .from('bt_reports')
    .select('*')
    .gte('data', data)
    .order('data', { ascending: true });
  return (rows as BtReport[]) || [];
}

export async function createBt(numero: string, data: string, dataFim?: string | null): Promise<BtReport | null> {
  const { data: rows, error } = await supabase
    .from('bt_reports')
    .insert([
      {
        numero,
        data,
        data_fim: dataFim || null,
        status: 'rascunho',
        instituicao: 'UNIVERSIDADE ESTADUAL PAULISTA - CAMPUS DE BOTUCATU',
        unidade: 'INSTITUTO DE BIOCIÊNCIAS CÂMPUS DE BOTUCATU - RECEITA PRÓPRIA',
      },
    ])
    .select();
  if (error) {
    console.error('Error creating BT:', error.message || error);
    return null;
  }
  return rows && rows.length > 0 ? (rows[0] as BtReport) : null;
}

export async function updateBtFields(
  id: string,
  fields: { numero: string; data: string; data_fim: string | null }
): Promise<boolean> {
  const { error } = await supabase.from('bt_reports').update(fields).eq('id', id);
  if (error) console.error('Error updating BT:', error.message || error);
  return !error;
}

export async function setBtStatus(id: string, status: BtReport['status']): Promise<boolean> {
  const { error } = await supabase.from('bt_reports').update({ status }).eq('id', id);
  if (error) console.error('Error updating BT status:', error.message || error);
  return !error;
}

export async function deleteBt(id: string): Promise<boolean> {
  const { error } = await supabase.from('bt_reports').delete().eq('id', id);
  if (error) console.error('Error deleting BT:', error.message || error);
  return !error;
}

export interface SignatureFields {
  elaborado_por: string | null;
  cargo_elaborado: string | null;
  conferido_por: string | null;
  cargo_conferido: string | null;
}

export async function updateBtSignatures(id: string, fields: SignatureFields): Promise<boolean> {
  const { error } = await supabase.from('bt_reports').update(fields).eq('id', id);
  if (error) console.error('Error updating BT signatures:', error.message || error);
  return !error;
}

// BT imediatamente anterior (por data) — usado para herdar assinaturas.
export async function fetchBtBefore(data: string): Promise<BtReport | null> {
  const { data: row } = await supabase
    .from('bt_reports')
    .select('*')
    .lt('data', data)
    .order('data', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (row as BtReport) || null;
}
