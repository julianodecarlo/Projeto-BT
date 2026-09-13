import { createContext, useContext, useState, useEffect, type ReactNode, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { seedDefaultAccounts } from '@/lib/seed';
import type { BtReport, Account } from '@/types';
import Decimal from 'decimal.js';

interface BtContextValue {
  currentBt: BtReport | null;
  accounts: Account[];
  loading: boolean;
  setCurrentBt: (bt: BtReport | null) => void;
  refreshAccounts: () => Promise<void>;
  createBt: (numero: string, data: string) => Promise<BtReport | null>;
  refreshBt: () => Promise<void>;
  cascadeRecalculate: (fromBtId: string) => Promise<void>;
}

const BtContext = createContext<BtContextValue | null>(null);

export function useBt() {
  const ctx = useContext(BtContext);
  if (!ctx) throw new Error('useBt must be used within BtProvider');
  return ctx;
}

export function BtProvider({ children }: { children: ReactNode }) {
  const [currentBt, setCurrentBt] = useState<BtReport | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .order('ordem', { ascending: true });
    if (!error && data) setAccounts(data as Account[]);
  }, []);

  const refreshAccounts = useCallback(async () => {
    await fetchAccounts();
  }, [fetchAccounts]);

  const refreshBt = useCallback(async () => {
    if (!currentBt) return;
    const { data } = await supabase
      .from('bt_reports')
      .select('*')
      .eq('id', currentBt.id)
      .maybeSingle();
    if (data) setCurrentBt(data as BtReport);
  }, [currentBt]);

  const createBt = useCallback(async (numero: string, data: string): Promise<BtReport | null> => {
    const { data: btData, error } = await supabase
      .from('bt_reports')
      .insert([
        {
          numero,
          data,
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

    if (!btData || btData.length === 0) return null;

    const created = btData[0] as BtReport;
    setCurrentBt(created);
    return created;
  }, []);

  const cascadeRecalculate = useCallback(async (fromBtId: string) => {
    const { data: editedBt } = await supabase
      .from('bt_reports')
      .select('*')
      .eq('id', fromBtId)
      .maybeSingle();
    if (!editedBt) return;

    const { data: subsequentBts } = await supabase
      .from('bt_reports')
      .select('*')
      .gte('data', editedBt.data)
      .order('data', { ascending: true });

    if (!subsequentBts || subsequentBts.length === 0) return;

    const { data: accs } = await supabase.from('accounts').select('*').order('ordem');
    if (!accs) return;

    for (const acc of accs as Account[]) {
      let runningBalance = new Decimal(acc.saldo_inicial || 0);

      for (const bt of subsequentBts as BtReport[]) {
        const { data: txs } = await supabase
          .from('transactions')
          .select('*')
          .eq('bt_report_id', bt.id)
          .eq('account_id', acc.id)
          .order('ordem', { ascending: true });

        if (!txs || txs.length === 0) continue;

        for (const tx of txs) {
          const saldoAnterior = runningBalance;
          const v = new Decimal(tx.valor || 0);
          const saldoFinal = tx.tipo_movimento === 'entrada'
            ? saldoAnterior.plus(v)
            : saldoAnterior.minus(v);

          await supabase.from('transactions').update({
            saldo_anterior: saldoAnterior.toNumber(),
            saldo_final: saldoFinal.toNumber(),
          }).eq('id', tx.id);

          runningBalance = saldoFinal;
        }
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await seedDefaultAccounts();
        await fetchAccounts();
        const { data: lastBt } = await supabase
          .from('bt_reports')
          .select('*')
          .order('data', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastBt) setCurrentBt(lastBt as BtReport);
      } catch (err) {
        console.error('Erro ao inicializar BtProvider:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchAccounts]);

  return (
    <BtContext.Provider value={{ currentBt, accounts, loading, setCurrentBt, refreshAccounts, createBt, refreshBt, cascadeRecalculate }}>
      {children}
    </BtContext.Provider>
  );
}
