import { createContext, useContext, useState, useEffect, useMemo, type ReactNode, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { seedDefaultAccounts } from '@/lib/seed';
import { transposeSaldos } from '@/lib/transpose';
import { forceRecalcBtSaldos, getBtAnterior, getSaldoAbertura } from '@/lib/recalc';
import { sortAccounts } from '@/lib/sortAccounts';
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
  updateSaldosReaberto: (btId: string) => Promise<string | null>;
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
    setAccounts(sortAccounts(await listAccounts()));
  }, []);

  const refreshBt = useCallback(async () => {
    if (!currentBt) return;
    const bt = await fetchBt(currentBt.id);
    if (bt) setCurrentBt(bt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBt?.id, setCurrentBt]);

  // Fonte única das conciliações do BT ativo: o Fechamento escuta este estado
  // e reavalia as validações em tempo real quando uma conta é conciliada.
  const refreshReconciliations = useCallback(async () => {
    if (!currentBt) {
      setReconciliations([]);
      return;
    }
    const { fetchReconciliations } = await import('@/services/reconciliationService');
    setReconciliations(await fetchReconciliations(currentBt.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBt?.id]);

  useEffect(() => {
    refreshReconciliations();
  }, [refreshReconciliations]);

  const createBt = useCallback(async (numero: string, data: string, dataFim?: string | null): Promise<BtReport | null> => {
    const created = await svcCreateBt(numero, data, dataFim);
    if (!created) return null;
    try {
      await transposeSaldos(created);
      // Após transpor, garante que a cadeia de saldos do novo BT parte EXATA
      // da âncora transposta (saldo final do BT anterior).
      const accs = sortAccounts(await listAccounts());
      await forceRecalcBtSaldos(created, accs);
    } catch (err) {
      console.error('Erro na transposição de saldos:', err);
    }
    setCurrentBt(created);
    return created;
  }, [setCurrentBt]);

  const cascadeRecalculate = useCallback(async (fromBtId: string) => {
    const editedBt = await fetchBt(fromBtId);
    if (!editedBt) return;
    const accs = sortAccounts(await listAccounts());
    if (accs.length === 0) return;
    const subsequent = await listBtsFromData(editedBt.data);
    // Recalcula cada BT da cadeia com abertura = saldo final do BT anterior.
    // BT fechado é IMUTÁVEL: não é reescrito — mas continua sendo a fonte da
    // abertura do BT seguinte, garantindo que o saldo inicial de um BT N seja
    // sempre o saldo final do BT N-1.
    for (const bt of subsequent) {
      if (bt.status === 'fechado') continue;
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
    const ok = await setBtStatus(id, 'reaberto');
    if (!ok) return false;
    if (currentBt?.id === id) {
      setCurrentBt({ ...currentBt, status: 'reaberto' });
    }
    return true;
  }, [currentBt, setCurrentBt]);

  // Fluxo manual de continuidade em BT reaberto: compara o saldo final do BT
  // anterior fechado com o saldo inicial armazenado no BT ALVO (que pode não
  // ser o atualmente aberto no app) e, se diferente, substitui a âncora "Saldo
  // Anterior" de cada conta afetada. Retorna null em sucesso ou mensagem de
  // erro legível — o modal exibe a mensagem, nunca falha em silêncio.
  const updateSaldosReaberto = useCallback(async (btId: string): Promise<string | null> => {
    const target = await fetchBt(btId);
    if (!target) return 'BT não encontrado.';
    // a) BT fechado é imutável: nunca gravar nele.
    if (target.status !== 'reaberto') {
      return 'Este BT não está reaberto. Reabra-o antes de atualizar os saldos.';
    }
    const prev = await getBtAnterior(target);
    if (!prev) return 'Não há BT anterior para comparar.';
    const accs = sortAccounts(await listAccounts());

    const aberturaMap = new Map<string, number>();
    for (const acc of accs) {
      aberturaMap.set(acc.id, await getSaldoAbertura(target, acc));
    }

    // Atualiza a transação âncora "Saldo Anterior" de cada conta cujo saldo
    // inicial armazenado difere do saldo final do BT anterior.
    const { data: anchors, error: anchorErr } = await supabase
      .from('transactions')
      .select('id, account_id, saldo_anterior')
      .eq('bt_report_id', target.id)
      .eq('descricao', 'Saldo Anterior');
    if (anchorErr) return 'Erro ao ler os saldos iniciais do BT. Tente novamente.';
    const rows = (anchors || []) as { id: string; account_id: string; saldo_anterior: number | null }[];

    const updates: Promise<Error | null>[] = [];
    for (const row of rows) {
      const novo = aberturaMap.get(row.account_id);
      if (novo === undefined) continue;
      if (Math.round((row.saldo_anterior || 0) * 100) === Math.round(novo * 100)) continue;
      updates.push(
        (async () => {
          // b) Confirma que a linha foi realmente alterada: 0 linhas afetadas é erro.
          const { data: updData, error: updErr } = await supabase
            .from('transactions')
            .update({ saldo_anterior: novo, saldo_final: novo })
            .eq('id', row.id)
            .select('id');
          if (updErr) return updErr;
          if (!updData || updData.length === 0) {
            return new Error('Linha de saldo inicial não encontrada ao gravar.');
          }
          return null;
        })()
      );
    }
    const results = await Promise.all(updates);
    if (results.some(r => r !== null)) {
      return 'Não foi possível gravar o saldo inicial. Verifique se o BT continua reaberto e tente novamente.';
    }

    // Reprocessa o BT alvo para propagar o novo saldo inicial pela cadeia de
    // lançamentos (âncora + entradas − saídas, linha por linha).
    await forceRecalcBtSaldos(target, accs);

    // c) Confirmação de leitura: relê as âncoras do banco e exige que cada uma
    // seja igual à abertura calculada (exatidão de centavos).
    const { data: recheck, error: recheckErr } = await supabase
      .from('transactions')
      .select('account_id, saldo_anterior')
      .eq('bt_report_id', target.id)
      .eq('descricao', 'Saldo Anterior');
    if (recheckErr) return 'Erro ao confirmar a gravação dos saldos. Tente novamente.';
    for (const r of (recheck || []) as { account_id: string; saldo_anterior: number | null }[]) {
      const esperado = aberturaMap.get(r.account_id);
      if (esperado === undefined) continue;
      if (Math.round((r.saldo_anterior || 0) * 100) !== Math.round(esperado * 100)) {
        return 'A gravação não foi confirmada no banco de dados. Nenhuma alteração foi aplicada — tente novamente.';
      }
    }

    // Se o BT alvo é o ativo, força refetch dos dados exibidos.
    if (currentBt?.id === target.id) {
      await refreshBt();
    }
    return null;
  }, [currentBt, refreshBt]);

  const deleteBt = useCallback(async (id: string): Promise<boolean> => {
    const bt = await fetchBt(id);
    const ok = await svcDeleteBt(id);
    if (!ok) return false;
    if (bt) {
      const remaining = await listBtsFromData(bt.data);
      if (remaining.length > 0) {
        // Um único recálculo em cadeia a partir do primeiro BT restante (data
        // crescente) cobre todos os BTs seguintes — mesmo resultado de hoje.
        await cascadeRecalculate(remaining[0].id);
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
          // Re-sincronização forçada apenas em BTs abertos: BT fechado é
          // imutável e não pode ter seus saldos gravados reescritos.
          if (lastBt.status !== 'fechado') {
            const accs = sortAccounts(await listAccounts());
            await forceRecalcBtSaldos(lastBt, accs);
          }
          setCurrentBt(lastBt);
        }
      } catch (err) {
        console.error('Erro ao inicializar BtProvider:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshAccounts, setCurrentBt]);

  const contextValue = useMemo(() => ({
    currentBt,
    accounts,
    reconciliations,
    refreshReconciliations,
    loading,
    setCurrentBt,
    refreshAccounts,
    createBt,
    updateBt,
    reopenBt,
    deleteBt,
    refreshBt,
    cascadeRecalculate,
    salvarBtRascunho,
    validarBtAtual,
    fecharBtAtual,
    updateSaldosReaberto,
  }), [currentBt, accounts, reconciliations, refreshReconciliations, loading, setCurrentBt, refreshAccounts, createBt, updateBt, reopenBt, deleteBt, refreshBt, cascadeRecalculate, salvarBtRascunho, validarBtAtual, fecharBtAtual, updateSaldosReaberto]);

  return (
    <BtContext.Provider value={contextValue}>
      {children}
    </BtContext.Provider>
  );
}
