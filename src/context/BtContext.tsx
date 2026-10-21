import { createContext, useContext, useState, useEffect, type ReactNode, useCallback } from 'react';
import { seedDefaultAccounts } from '@/lib/seed';
import { transposeSaldos } from '@/lib/transpose';
import { forceRecalcBtSaldos } from '@/lib/recalc';
import { validarBtCentral as runValidacao, type PendenciaItem } from '@/lib/validacao';
import { fetchValidacaoData } from '@/lib/btData';
import {
  listAccounts,
  fetchBt,
  fetchLatestBt,
  createBt as svcCreateBt,
  updateBtFields,
  setBtStatus,
  deleteBt as svcDeleteBt,
  listBtsFromData,
} from '@/services/btService';
import type { BtReport, Account, Reconciliation } from '@/types';

interface BtContextValue {
  currentBt: BtReport | null;
  accounts: Account[];
  reconciliations: Reconciliation[];
  refreshReconciliations: () => Promise<void>;
  loading: boolean;
  setCurrentBt: (bt: BtReport | null) => void;
  refreshAccounts: () => Promise<void>;
  createBt: (numero: string, data: string, dataFim?: string | null) => Promise<BtReport | null>;
  updateBt: (id: string, fields: { numero: string; data: string; data_fim: string | null }) => Promise<boolean>;
  reopenBt: (id: string) => Promise<boolean>;
  deleteBt: (id: string) => Promise<boolean>;
  refreshBt: () => Promise<void>;
  cascadeRecalculate: (fromBtId: string) => Promise<void>;
  salvarBtRascunho: () => Promise<boolean>;
  validarBtAtual: () => Promise<PendenciaItem[]>;
  fecharBtAtual: () => Promise<PendenciaItem[]>;
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
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [loading, setLoading] = useState(true);

  const setCurrentBt = useCallback((bt: BtReport | null) => {
    setCurrentBtState(bt);
    storeBt(bt);
  }, []);

  const refreshAccounts = useCallback(async () => {
    setAccounts(await listAccounts());
  }, []);

  const refreshBt = useCallback(async () => {
    if (!currentBt) return;
    const bt = await fetchBt(currentBt.id);
    if (bt) setCurrentBt(bt);
  }, [currentBt, setCurrentBt]);

  // Fonte única das conciliações do BT ativo: o Fechamento escuta este estado
  // e reavalia as validações em tempo real quando uma conta é conciliada.
  const refreshReconciliations = useCallback(async () => {
    if (!currentBt) {
      setReconciliations([]);
      return;
    }
    const { fetchReconciliations } = await import('@/services/reconciliationService');
    setReconciliations(await fetchReconciliations(currentBt.id));
  }, [currentBt]);

  useEffect(() => {
    refreshReconciliations();
  }, [refreshReconciliations]);

  const createBt = useCallback(async (numero: string, data: string, dataFim?: string | null): Promise<BtReport | null> => {
    const created = await svcCreateBt(numero, data, dataFim);
    if (!created) return null;
    try {
      await transposeSaldos(created);
    } catch (err) {
      console.error('Erro na transposição de saldos:', err);
    }
    setCurrentBt(created);
    return created;
  }, [setCurrentBt]);

  const cascadeRecalculate = useCallback(async (fromBtId: string) => {
    const editedBt = await fetchBt(fromBtId);
    if (!editedBt) return;
    const accs = await listAccounts();
    if (accs.length === 0) return;
    const subsequent = await listBtsFromData(editedBt.data);
    // Recalcula cada BT da cadeia com abertura = saldo final do BT anterior
    for (const bt of subsequent) {
      await forceRecalcBtSaldos(bt, accs);
    }
  }, []);

  const salvarBtRascunho = useCallback(async (): Promise<boolean> => {
    if (!currentBt) return false;
    // Persistência geral: recalcula os saldos de todas as contas do BT a partir
    // do zero (sobrescreve rascunhos sem duplicar lançamentos).
    await forceRecalcBtSaldos(currentBt, accounts);
    const ok = await setBtStatus(currentBt.id, 'rascunho');
    if (!ok) return false;
    await refreshBt();
    return true;
  }, [currentBt, accounts, refreshBt]);

  const validarBtAtual = useCallback(async (): Promise<PendenciaItem[]> => {
    if (!currentBt) return [{ location: 'Sistema', message: 'Nenhum BT ativo.' }];
    await refreshBt();
    const data = await fetchValidacaoData(currentBt.id, accounts, reconciliations);
    const pend = data ? runValidacao(data) : [{ location: 'Sistema', message: 'BT não encontrado.' }];
    if (pend.length === 0) {
      const ok = await setBtStatus(currentBt.id, 'validado');
      if (!ok) console.error('Erro ao marcar BT como validado');
      await refreshBt();
    }
    return pend;
  }, [currentBt, accounts, reconciliations, refreshBt]);

  const fecharBtAtual = useCallback(async (): Promise<PendenciaItem[]> => {
    if (!currentBt) return [{ location: 'Sistema', message: 'Nenhum BT ativo.' }];
    await forceRecalcBtSaldos(currentBt, accounts);
    const data = await fetchValidacaoData(currentBt.id, accounts, reconciliations);
    const pend = data ? runValidacao(data) : [{ location: 'Sistema', message: 'BT não encontrado.' }];
    if (pend.length > 0) return pend;
    const ok = await setBtStatus(currentBt.id, 'fechado');
    if (!ok) {
      return [{ location: 'Sistema', message: 'Não foi possível fechar o BT. Tente novamente.' }];
    }
    await refreshBt();
    return [];
  }, [currentBt, accounts, reconciliations, refreshBt]);

  const updateBt = useCallback(async (id: string, fields: { numero: string; data: string; data_fim: string | null }): Promise<boolean> => {
    const ok = await updateBtFields(id, fields);
    if (!ok) return false;
    await cascadeRecalculate(id);
    if (currentBt?.id === id) {
      setCurrentBt({ ...currentBt, ...fields });
    }
    return true;
  }, [cascadeRecalculate, currentBt, setCurrentBt]);

  const reopenBt = useCallback(async (id: string): Promise<boolean> => {
    const ok = await setBtStatus(id, 'rascunho');
    if (!ok) return false;
    if (currentBt?.id === id) {
      setCurrentBt({ ...currentBt, status: 'rascunho' });
    }
    return true;
  }, [currentBt, setCurrentBt]);

  const deleteBt = useCallback(async (id: string): Promise<boolean> => {
    const bt = await fetchBt(id);
    const ok = await svcDeleteBt(id);
    if (!ok) return false;
    if (bt) {
      const remaining = await listBtsFromData(bt.data);
      for (const r of remaining) {
        await cascadeRecalculate(r.id);
      }
    }
    if (currentBt?.id === id) {
      setCurrentBt(null);
    }
    return true;
  }, [cascadeRecalculate, currentBt, setCurrentBt]);

  useEffect(() => {
    (async () => {
      try {
        await seedDefaultAccounts();
        await refreshAccounts();
        const lastBt = await fetchLatestBt();
        if (lastBt) {
          // Re-sincronização forçada: recalcula do zero e sobrescreve os saldos
          // salvos no banco para todas as contas do BT ativo antes de qualquer aba renderizar
          const accs = await listAccounts();
          await forceRecalcBtSaldos(lastBt, accs);
          setCurrentBt(lastBt);
        }
      } catch (err) {
        console.error('Erro ao inicializar BtProvider:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshAccounts, setCurrentBt]);

  return (
    <BtContext.Provider value={{ currentBt, accounts, reconciliations, refreshReconciliations, loading, setCurrentBt, refreshAccounts, createBt, updateBt, reopenBt, deleteBt, refreshBt, cascadeRecalculate, salvarBtRascunho, validarBtAtual, fecharBtAtual }}>
      {children}
    </BtContext.Provider>
  );
}
