import { createContext, useContext, useState, useEffect, type ReactNode, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { seedDefaultAccounts } from '@/lib/seed';
import { transposeSaldos } from '@/lib/transpose';
import type { BtReport, Account } from '@/types';
import Decimal from 'decimal.js';

interface BtContextValue {
  currentBt: BtReport | null;
  accounts: Account[];
  loading: boolean;
  setCurrentBt: (bt: BtReport | null) => void;
  refreshAccounts: () => Promise<void>;
  createBt: (numero: string, data: string, dataFim?: string | null) => Promise<BtReport | null>;
  updateBt: (id: string, fields: { numero: string; data: string; data_fim: string | null }) => Promise<boolean>;
  reopenBt: (id: string) => Promise<boolean>;
  deleteBt: (id: string) => Promise<boolean>;
  refreshBt: () => Promise<void>;
  cascadeRecalculate: (fromBtId: string) => Promise<void>;
}

const BtContext = createContext<BtContextValue | null>(null);

export function useBt() {
  const ctx = useContext(BtContext);
  if (!ctx) throw new Error('useBt must be used within BtProvider');
  return ctx;
}

const BT_STORAGE_KEY = 'bt_current';

const loadStoredBt = (): BtReport | null => {
  try {
    const raw = localStorage.getItem(BT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BtReport) : null;
  } catch {
    return null;
  }
};

const storeBt = (bt: BtReport | null) => {
  try {
    if (bt) localStorage.setItem(BT_STORAGE_KEY, JSON.stringify(bt));
    else localStorage.removeItem(BT_STORAGE_KEY);
  } catch {
    // localStorage indisponível — ignora
  }
};

export function BtProvider({ children }: { children: ReactNode }) {
  const [currentBt, setCurrentBtState] = useState<BtReport | null>(loadStoredBt);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const setCurrentBt = useCallback((bt: BtReport | null) => {
    setCurrentBtState(bt);
    storeBt(bt);
  }, []);

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

  const createBt = useCallback(async (numero: string, data: string, dataFim?: string | null): Promise<BtReport | null> => {
    const { data: btData, error } = await supabase
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

    if (!btData || btData.length === 0) return null;

    const created = btData[0] as BtReport;
    try {
      await transposeSaldos(created);
    } catch (err) {
      console.error('Erro na transposição de saldos:', err);
    }
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

  const updateBt = useCallback(async (id: string, fields: { numero: string; data: string; data_fim: string | null }): Promise<boolean> => {
    const { error } = await supabase.from('bt_reports').update(fields).eq('id', id);
    if (error) {
      console.error('Error updating BT:', error.message || error);
      return false;
    }
    await cascadeRecalculate(id);
    if (currentBt?.id === id) {
      setCurrentBt({ ...currentBt, ...fields });
    }
    return true;
  }, [cascadeRecalculate, currentBt]);

  const reopenBt = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('bt_reports').update({ status: 'rascunho' }).eq('id', id);
    if (error) {
      console.error('Error reopening BT:', error.message || error);
      return false;
    }
    if (currentBt?.id === id) {
      setCurrentBt({ ...currentBt, status: 'rascunho' });
    }
    return true;
  }, [currentBt]);

  const deleteBt = useCallback(async (id: string): Promise<boolean> => {
    const { data: bt } = await supabase.from('bt_reports').select('data').eq('id', id).maybeSingle();
    const { error } = await supabase.from('bt_reports').delete().eq('id', id);
    if (error) {
      console.error('Error deleting BT:', error.message || error);
      return false;
    }
    if (bt) {
      const { data: remaining } = await supabase
        .from('bt_reports')
        .select('id')
        .gte('data', bt.data)
        .order('data', { ascending: true });
      for (const r of remaining || []) {
        await cascadeRecalculate(r.id);
      }
    }
    if (currentBt?.id === id) {
      setCurrentBt(null);
    }
    return true;
  }, [cascadeRecalculate, currentBt]);

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
    <BtContext.Provider value={{ currentBt, accounts, loading, setCurrentBt, refreshAccounts, createBt, updateBt, reopenBt, deleteBt, refreshBt, cascadeRecalculate }}>
      {children}
    </BtContext.Provider>
  );
}
