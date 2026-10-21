import { supabase } from '@/lib/supabase';
import type { Convenio, FonteOrcamentaria } from '@/types';

export interface ConvenioInput {
  nome: string;
  fonte_5: number;
  fonte_45: number;
  fonte_4: number;
  fonte_44: number;
  finance_account_id: string | null;
}

export async function listConvenios(): Promise<Convenio[]> {
  const { data } = await supabase.from('convenios').select('*').order('nome');
  return (data as Convenio[]) || [];
}

export async function createConvenio(payload: ConvenioInput): Promise<Convenio | null> {
  const { data, error } = await supabase.from('convenios').insert(payload).select().single();
  return !error && data ? (data as Convenio) : null;
}

export async function updateConvenio(id: string, payload: ConvenioInput): Promise<Convenio | null> {
  const { data, error } = await supabase.from('convenios').update(payload).eq('id', id).select().single();
  return !error && data ? (data as Convenio) : null;
}

export async function deleteConvenio(id: string): Promise<boolean> {
  const { error } = await supabase.from('convenios').delete().eq('id', id);
  return !error;
}

// Atualiza um único campo de fonte orçamentária (fonte_5/45/4/44) do convênio.
export async function updateConvenioFonte(
  id: string,
  fonte: FonteOrcamentaria,
  valor: number
): Promise<boolean> {
  const { error } = await supabase.from('convenios').update({ [fonte]: valor }).eq('id', id);
  if (error) console.error('Erro ao atualizar fonte do convênio:', error.message || error);
  return !error;
}
