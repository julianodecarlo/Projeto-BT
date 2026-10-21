import { supabase } from './supabase';
import type { Account } from '@/types';

const defaultAccounts: Omit<Account, 'id' | 'created_at'>[] = [
  { nome: 'Banco do Brasil - Movimento', categoria: 'movimento', codigo: '150000-8', ativo: true, ordem: 1, saldo_inicial: 0 },
  { nome: 'Banco do Brasil - Receita', categoria: 'receita', codigo: '150046-0', ativo: true, ordem: 2, saldo_inicial: 0 },
  { nome: 'Banco do Brasil - Diárias', categoria: 'diarias', codigo: '150048-6', ativo: true, ordem: 3, saldo_inicial: 0 },
  { nome: 'Banco do Brasil - Convênios', categoria: 'convenio', codigo: '150050-8', ativo: true, ordem: 4, saldo_inicial: 0 },
  { nome: 'Banco do Brasil - Caução', categoria: 'caucao', codigo: '150052-4', ativo: true, ordem: 5, saldo_inicial: 0 },
  { nome: 'Banco do Brasil - Depósito Judicial', categoria: 'deposito_judicial', codigo: '150053-2', ativo: true, ordem: 6, saldo_inicial: 0 },
];

export async function seedDefaultAccounts(): Promise<void> {
  const { count } = await supabase.from('accounts').select('*', { count: 'exact', head: true });
  if (count && count > 0) return;
  await supabase.from('accounts').insert(defaultAccounts);
}
