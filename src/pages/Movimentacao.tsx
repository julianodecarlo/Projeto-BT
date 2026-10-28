import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Save, FileText, Check, Landmark, Shuffle, Pencil, Trash2, X, ArrowDownToLine, AlertTriangle } from 'lucide-react';
import { useBt } from '@/context/BtContext';
import {
  listTransactions,
  insertEntry,
  insertTransferPair,
  updateTransaction,
  deleteTransaction,
  deleteTransactions,
  recalcAccountSaldos as svcRecalcAccountSaldos,
} from '@/services/transactionService';
import { Card, Button, EmptyState, Field, Select } from '@/components/ui/Field';
import Modal from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { formatCurrency, formatDate, toDecimal, toNumber, sumDecimal, todayISO } from '@/lib/format';
import type { Transaction, BudgetType, FonteOrcamentaria } from '@/types';
import { listConvenios } from '@/services/convenioService';
import { recalcConveniosPorContas } from '@/services/convenioRecalc';
import type { Convenio } from '@/types';
import { BtFechadoGuard, BtFechadoBanner } from '@/components/BtFechadoGuard';
import { sortAccounts } from '@/lib/sortAccounts';
import { setUnsavedGuard, setUnsavedSaver, hasUnsavedGuard } from '@/lib/unsavedGuard';

interface RowInput {
  vigente: string;
  restos_pagar: string;
  diversos_credores: string;
}

export default function Movimentacao() {
  const { currentBt, accounts } = useBt();
  const fechado = currentBt?.status === 'fechado';
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [inputs, setInputs] = useState<Record<string, RowInput>>({});
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Formulários de transferência
  const [repasseValor, setRepasseValor] = useState<number | null>(null);
  const [livreOrigem, setLivreOrigem] = useState('');
  const [livreDestino, setLivreDestino] = useState('');
  const [livreValor, setLivreValor] = useState<number | null>(null);
  const [transferFlash, setTransferFlash] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [editingTransfer, setEditingTransfer] = useState<{ ids: string[]; origemId: string; destinoId: string; valor: number } | null>(null);
  const [editingRepasse, setEditingRepasse] = useState<{ id: string; valor: number } | null>(null);

  // Depósitos / Anulações
  const [depAccountId, setDepAccountId] = useState('');
  const [depKind, setDepKind] = useState<'deposito' | 'anulacao'>('deposito');
  const [depValor, setDepValor] = useState<number | null>(null);
  const [depData, setDepData] = useState(todayISO());
  const [depDescricao, setDepDescricao] = useState('');
  const [editingDep, setEditingDep] = useState<string | null>(null);

  // Fonte orçamentária: obrigatória quando a conta selecionada é convênio
  const [convenios, setConvenios] = useState<Convenio[]>([]);
  const [depFonte, setDepFonte] = useState<FonteOrcamentaria | ''>('');
  const depConta = accounts.find(a => a.id === depAccountId);
  const isContaConvenio = depConta?.categoria === 'convenio';

  useEffect(() => {
    listConvenios().then(setConvenios);
  }, []);

  // Estado "sujo" (isDirty): só é verdadeiro quando algum valor digitado
  // DIFERE do snapshot gravado no banco. A comparação é feita campo a campo,
  // normalizada em centavos (conversão estrita de tipos + sanitização), nunca
  // por referência de objeto — objetos novos a cada render seriam sempre "diferentes".
  // Snapshot do que está gravado no banco (estado reativo). A comparação do
  // dirty state é sempre contra este estado, nunca por referência de objeto.
  const [savedSnapshot, setSavedSnapshot] = useState<Record<string, RowInput>>({});

  // Normaliza "1.234,56" / "1234.56" / "" / "abc" para centavos inteiros.
  const toCents = (raw: string | undefined): number => {
    const s = String(raw ?? '').trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    if (isNaN(n) || n === 0) return 0;
    return Math.round(n * 100);
  };

  const hasUnsavedInputs = useMemo(
    () => Object.keys(inputs).some(accId => {
      const row = inputs[accId];
      const saved = savedSnapshot[accId];
      return (
        toCents(row?.vigente) !== toCents(saved?.vigente) ||
        toCents(row?.restos_pagar) !== toCents(saved?.restos_pagar) ||
        toCents(row?.diversos_credores) !== toCents(saved?.diversos_credores)
      );
    }),
    [inputs, savedSnapshot]
  );

  // Sincroniza o guard global SEMPRE que o cálculo é reavaliado: se
  // hasRealChanges for false, a navegação entre abas fica livre.
  useEffect(() => {
    setUnsavedGuard('movimentacao', hasUnsavedInputs);
  }, [hasUnsavedInputs]);

  // Ao desmontar a aba (troca de aba concluída), o guard é resetado: sem
  // alterações pendentes remanescentes, nenhuma caixa de diálogo pode disparar.
  useEffect(() => {
    return () => setUnsavedGuard('movimentacao', false);
  }, []);

  // Registra o salvamento da tela: executado pela barreira de navegação
  // quando o usuário escolhe "Salvar" no aviso de alterações não salvas.
  const handleSaveRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    return setUnsavedSaver('movimentacao', async () => {
      await handleSaveRef.current();
      return true;
    });
  }, []);

  // Barreira ENTRE módulos da mesma aba: interage com Repasse/Transferência/
  // Depósitos enquanto há valores não salvos no Lançamento de Movimentações
  // é interrompido e o usuário decide salvar/descartar antes de continuar.
  const [showModuleGuard, setShowModuleGuard] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const interceptIfDirty = (e: React.SyntheticEvent) => {
    if (!hasUnsavedGuard()) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement;
    pendingActionRef.current = () => { target.click(); };
    setShowModuleGuard(true);
  };

  const handleFocusCapture = (e: React.FocusEvent) => {
    if (!hasUnsavedGuard()) return;
    (e.target as HTMLElement).blur();
    pendingActionRef.current = null;
    setShowModuleGuard(true);
  };

  const closeModuleGuard = () => {
    setShowModuleGuard(false);
    pendingActionRef.current = null;
  };

  const discardInputs = () => {
    const state: Record<string, RowInput> = {};
    for (const acc of accounts) {
      state[acc.id] = { vigente: '', restos_pagar: '', diversos_credores: '' };
    }
    for (const tx of transactions) {
      if (tx.descricao === 'Saldo Anterior') continue;
      if (tx.tipo != null) continue;
      if (!state[tx.account_id]) state[tx.account_id] = { vigente: '', restos_pagar: '', diversos_credores: '' };
      const key = tx.tipo_orcamento || 'vigente';
      if (key in state[tx.account_id]) {
        state[tx.account_id][key as keyof RowInput] = String(tx.valor || '');
      }
    }
    setSavedSnapshot(state);
    setInputs(state);
    setUnsavedGuard('movimentacao', false);
  };

  const fetchTransactions = useCallback(async () => {
    if (!currentBt) return;
    const data = await listTransactions(currentBt.id);
    setTransactions(data);
    buildInputState(data);
  }, [currentBt]);

  const buildInputState = (txs: Transaction[]) => {
    const state: Record<string, RowInput> = {};
    for (const acc of accounts) {
      state[acc.id] = { vigente: '', restos_pagar: '', diversos_credores: '' };
    }
    for (const tx of txs) {
      if (tx.descricao === 'Saldo Anterior') continue;
      if (tx.tipo != null) continue; // repasses/transferências aparecem apenas na coluna própria
      if (!state[tx.account_id]) state[tx.account_id] = { vigente: '', restos_pagar: '', diversos_credores: '' };
      const key = tx.tipo_orcamento || 'vigente';
      if (key in state[tx.account_id]) {
        state[tx.account_id][key as keyof RowInput] = String(tx.valor || '');
      }
    }
    // Snapshot do que está gravado: o dirty state compara os valores digitados
    // contra ESTE estado. Carregamento do BT: guard inicia liberado.
    setSavedSnapshot(state);
    setInputs(state);
    // Carregamento do BT: sem edições pendentes, o guard inicia liberado.
    setUnsavedGuard('movimentacao', false);
  };

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    if (accounts.length > 0 && transactions.length === 0) {
      const state: Record<string, RowInput> = {};
      for (const acc of accounts) {
        state[acc.id] = { vigente: '', restos_pagar: '', diversos_credores: '' };
      }
      setSavedSnapshot(state);
      setInputs(state);
      setUnsavedGuard('movimentacao', false);
    }
  }, [accounts, transactions.length]);

  const getAccountSaldoAnterior = (accId: string): number => {
    const acc = accounts.find(a => a.id === accId);
    if (!acc) return 0;
    const abertura = transactions.find(t => t.account_id === accId && t.descricao === 'Saldo Anterior');
    if (abertura) return abertura.saldo_anterior;
    return acc.saldo_inicial;
  };

  const getAccountSubtotal = (accId: string): number => {
    const row = inputs[accId];
    if (!row) return 0;
    return toNumber(
      sumDecimal([
        row.vigente || 0,
        row.restos_pagar || 0,
        row.diversos_credores || 0,
      ])
    );
  };

  // Soma líquida das transferências (repasse, livre, depósitos/anulações) por conta
  const transferenciasPorConta = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.tipo === 'repasse_reitoria' || tx.tipo === 'transf_livre' || tx.tipo === 'transf_tesouro_receita' || tx.tipo === 'transf_tesouro_diarias' || tx.tipo === 'deposito_anulacao') {
      const atual = transferenciasPorConta.get(tx.account_id) ?? 0;
      transferenciasPorConta.set(
        tx.account_id,
        tx.tipo_movimento === 'entrada' ? atual + tx.valor : atual - tx.valor
      );
    }
  }

  // Fórmula única: Saldo Final = Saldo Anterior + Entradas (transferências + depósitos/anulações) − Saídas (colunas orçamentárias)
  const getAccountSaldoFinal = (accId: string): number => {
    const saidas = getAccountSubtotal(accId);
    const entradas = transferenciasPorConta.get(accId) ?? 0;
    return toDecimal(getAccountSaldoAnterior(accId)).plus(toDecimal(entradas)).minus(toDecimal(saidas)).toNumber();
  };

  const handleInputChange = (accId: string, field: keyof RowInput, value: string) => {
    setInputs(prev => ({
      ...prev,
      [accId]: { ...prev[accId], [field]: value },
    }));
  };

  // Idempotente: uma única linha por conta × coluna orçamentária no BT.
  // Salvar 1, 5 ou 10 vezes produz sempre o mesmo estado no banco (UPSERT).
  const handleSave = async () => {
    if (!currentBt) return;
    const existingBudget = transactions.filter(t => t.tipo_orcamento != null);
    const saldoAnteriorMap: Record<string, number> = {};
    for (const acc of accounts) {
      saldoAnteriorMap[acc.id] = getAccountSaldoAnterior(acc.id);
    }

    const activeAccs = accounts.filter(a => a.ativo);
    // Contas realmente tocadas por este salvamento: apenas elas terão a cadeia
    // de saldos refeita — salvamento local é leve e não varre o banco inteiro.
    const touched = new Set<string>();
    const entries: { field: keyof RowInput; tipo: BudgetType; desc: string }[] = [
      { field: 'vigente', tipo: 'vigente', desc: 'Orçamento Vigente' },
      { field: 'restos_pagar', tipo: 'restos_pagar', desc: 'Restos a Pagar' },
      { field: 'diversos_credores', tipo: 'diversos_credores', desc: 'Diversos Credores' },
    ];

    for (const acc of activeAccs) {
      const row = inputs[acc.id];
      if (!row) continue;
      for (const entry of entries) {
        const existing = existingBudget.find(t => t.account_id === acc.id && t.tipo_orcamento === entry.tipo);
        const val = row[entry.field];
        const v = val && parseFloat(val) > 0 ? toDecimal(val).toNumber() : 0;

        if (v === 0) {
          // Campo esvaziado: remove a linha antiga (se existir)
          if (existing) {
            await deleteTransaction(existing.id);
            touched.add(acc.id);
          }
          continue;
        }

        if (existing) {
          if (existing.valor !== v) {
            await updateTransaction(existing.id, { valor: v });
            touched.add(acc.id);
          }
          saldoAnteriorMap[acc.id] = existing.saldo_final;
        } else {
          const saldoAnt = saldoAnteriorMap[acc.id];
          const saldoFin = toDecimal(saldoAnt).minus(v).toNumber();
          await insertEntry({
            btReportId: currentBt.id,
            accountId: acc.id,
            descricao: entry.desc,
            tipoMovimento: 'saida',
            valor: v,
            saldoAnterior: saldoAnt,
            saldoFinal: saldoFin,
            dataLancamento: currentBt.data,
            tipoOrcamento: entry.tipo,
          });
          touched.add(acc.id);
          saldoAnteriorMap[acc.id] = saldoFin;
        }
      }
    }

    // Recalcula SOMENTE as contas cujos valores mudaram; as demais mantêm a
    // cadeia já gravada. O recálculo completo em cadeia acontece no Validar/
    // Fechar BT (e no Salvar BT do menu lateral).
    for (const accId of touched) {
      await recalcAccountSaldos(accId);
    }
    await fetchTransactions();
    setUnsavedGuard('movimentacao', false);
    setSavedFlash('Movimentações salvas com sucesso!');
    setTimeout(() => setSavedFlash(null), 3000);
  };
  handleSaveRef.current = handleSave;

  // Recria a cadeia saldo_anterior → saldo_final de uma conta após inserir, editar ou excluir lançamentos
  const recalcAccountSaldos = async (accId: string) => {
    if (!currentBt) return;
    const saldoInicial = accounts.find(a => a.id === accId)?.saldo_inicial ?? 0;
    await svcRecalcAccountSaldos(currentBt.id, accId, saldoInicial);
  };

  const insertTransfer = async (
    tipo: 'repasse_reitoria' | 'transf_livre',
    fromId: string | null,
    toId: string | null,
    valor: number,
    descricao: string
  ): Promise<boolean> => {
    if (!currentBt || valor <= 0) return false;
    return insertTransferPair({
      btReportId: currentBt.id,
      dataLancamento: currentBt.data,
      tipo,
      fromId,
      toId,
      valor,
      descricao,
    });
  };

  const handleSaveRepasse = async () => {
    if (!currentBt || !repasseValor || repasseValor <= 0) return;
    const tesouro = accounts.find(a => a.nome.toLowerCase().includes('tesouro'));
    if (!tesouro) {
      setTransferError('Conta Tesouro não encontrada. Cadastre uma conta com "Tesouro" no nome.');
      return;
    }
    setSavingTransfer(true);
    setTransferError(null);
    if (editingRepasse) {
      const ok = await updateTransaction(editingRepasse.id, { valor: repasseValor });
      if (ok) await recalcAccountSaldos(tesouro.id);
      setSavingTransfer(false);
      if (ok) {
        setEditingRepasse(null);
        setRepasseValor(null);
        setTransferFlash('Repasse atualizado.');
        setTimeout(() => setTransferFlash(null), 3000);
        fetchTransactions();
      } else {
        setTransferError('Não foi possível atualizar o repasse. Tente novamente.');
      }
      return;
    }
    const ok = await insertTransfer('repasse_reitoria', null, tesouro.id, repasseValor, 'Repasse Financeiro da Reitoria');
    if (ok) await recalcAccountSaldos(tesouro.id);
    setSavingTransfer(false);
    if (ok) {
      setRepasseValor(null);
      setTransferFlash('Repasse registrado e somado à Conta Tesouro.');
      setTimeout(() => setTransferFlash(null), 3000);
      fetchTransactions();
    } else {
      setTransferError('Não foi possível registrar o repasse. Tente novamente.');
    }
  };

  const startEditRepasse = (tx: Transaction) => {
    setEditingRepasse({ id: tx.id, valor: tx.valor });
    setRepasseValor(tx.valor);
  };

  const deleteRepasse = async (tx: Transaction) => {
    const tesouro = accounts.find(a => a.nome.toLowerCase().includes('tesouro'));
    await deleteTransaction(tx.id);
    if (editingRepasse?.id === tx.id) {
      setEditingRepasse(null);
      setRepasseValor(null);
    }
    if (tesouro) await recalcAccountSaldos(tesouro.id);
    fetchTransactions();
  };

  const handleSaveLivre = async () => {
    if (!currentBt) return;
    if (!livreOrigem || !livreDestino) {
      setTransferError('Selecione a conta de origem e a conta de destino.');
      return;
    }
    if (!livreValor || livreValor === 0) {
      setTransferError('Informe um valor diferente de zero.');
      return;
    }
    if (livreOrigem === livreDestino) {
      setTransferError('A conta origem e a conta destino devem ser diferentes.');
      return;
    }
    setSavingTransfer(true);
    setTransferError(null);
    // Na edição, remove o par antigo antes de registrar o novo
    if (editingTransfer) {
      await deleteTransactions(editingTransfer.ids);
    }
    const valor = Math.abs(livreValor);
    const inverte = livreValor < 0;
    const fromId = inverte ? livreDestino : livreOrigem;
    const toId = inverte ? livreOrigem : livreDestino;
    const origem = accounts.find(a => a.id === livreOrigem);
    const destino = accounts.find(a => a.id === livreDestino);
    const ok = await insertTransfer(
      'transf_livre',
      fromId,
      toId,
      valor,
      `Transferência ${origem?.nome} → ${destino?.nome}`
    );
    if (ok) {
      await recalcAccountSaldos(fromId);
      await recalcAccountSaldos(toId);
    }
    setSavingTransfer(false);
    if (ok) {
      setLivreValor(null);
      setEditingTransfer(null);
      setTransferFlash(editingTransfer ? 'Transferência atualizada.' : 'Transferência registrada.');
      setTimeout(() => setTransferFlash(null), 3000);
      fetchTransactions();
    } else {
      setTransferError('Não foi possível registrar a transferência. Tente novamente.');
    }
  };

  const startEditTransfer = (p: { saida: Transaction; entrada: Transaction }) => {
    setEditingTransfer({
      ids: [p.saida.id, p.entrada.id],
      origemId: p.saida.account_id,
      destinoId: p.entrada.account_id,
      valor: p.saida.valor,
    });
    setLivreOrigem(p.saida.account_id);
    setLivreDestino(p.entrada.account_id);
    setLivreValor(p.saida.valor);
  };

  const deleteTransfer = async (p: { saida: Transaction; entrada: Transaction }) => {
    const ids = p.saida.id === p.entrada.id ? [p.saida.id] : [p.saida.id, p.entrada.id];
    await deleteTransactions(ids);
    if (editingTransfer && ids.some(id => editingTransfer.ids.includes(id))) {
      setEditingTransfer(null);
      setLivreValor(null);
    }
    await recalcAccountSaldos(p.saida.account_id);
    if (p.entrada.account_id !== p.saida.account_id) await recalcAccountSaldos(p.entrada.account_id);
    fetchTransactions();
  };

  // Anulação de despesa também credita a conta (estorno), nunca debita.
  // Em contas de convênio, o valor lançado também soma na fonte orçamentária
  // correspondente (Fonte 5/45/4/44) do convênio vinculado à conta.
  const handleSaveDeposito = async () => {
    if (!currentBt || !depAccountId || !depValor || depValor === 0) return;
    if (isContaConvenio && !depFonte) {
      setTransferError('Selecione a Fonte Orçamentária (5, 45, 4 ou 44) para contas de convênio.');
      return;
    }
    setSavingTransfer(true);
    setTransferError(null);
    const valor = Math.abs(depValor);
    const fonteLabels: Record<FonteOrcamentaria, string> = {
      fonte_5: 'Fonte 5', fonte_45: 'Fonte 45', fonte_4: 'Fonte 4', fonte_44: 'Fonte 44',
    };
    const sufixoFonte = isContaConvenio && depFonte ? ` (${fonteLabels[depFonte]})` : '';
    const descricao = (depDescricao.trim() || (depKind === 'deposito' ? 'Depósito' : 'Anulação')) + sufixoFonte;
    if (editingDep) {
      const ok = await updateTransaction(editingDep, {
        valor,
        descricao,
        data_lancamento: depData || currentBt.data,
        fonte_orcamentaria: isContaConvenio ? (depFonte || null) : null,
        natureza: depKind,
      });
      if (ok) {
        await recalcAccountSaldos(depAccountId);
        await recalcFontesConvenio([depAccountId]);
      }
      setSavingTransfer(false);
      if (ok) {
        setEditingDep(null);
        setDepValor(null);
        setDepDescricao('');
        setDepKind('deposito');
        setDepFonte('');
        setDepData(todayISO());
        setTransferFlash('Lançamento atualizado.');
        setTimeout(() => setTransferFlash(null), 3000);
        fetchTransactions();
      } else {
        setTransferError('Não foi possível atualizar o lançamento. Tente novamente.');
      }
      return;
    }
    const ok = await insertEntry({
      btReportId: currentBt.id,
      accountId: depAccountId,
      descricao,
      tipoMovimento: 'entrada',
      valor,
      dataLancamento: depData || currentBt.data,
      tipo: 'deposito_anulacao',
      fonteOrcamentaria: isContaConvenio ? (depFonte || null) : null,
      natureza: depKind,
    });
    if (ok) {
      await recalcAccountSaldos(depAccountId);
      await recalcFontesConvenio([depAccountId]);
    }
    setSavingTransfer(false);
    if (ok) {
      setDepValor(null);
      setDepDescricao('');
      setDepFonte('');
      setTransferFlash(isContaConvenio && depFonte
        ? `Lançamento registrado e somado ao saldo da conta e da ${fonteLabels[depFonte]}.`
        : 'Lançamento registrado e somado ao saldo da conta.');
      setTimeout(() => setTransferFlash(null), 3000);
      fetchTransactions();
    } else {
      setTransferError('Não foi possível registrar o lançamento. Tente novamente.');
    }
  };

  // Recálculo IDEMPOTENTE das fontes dos convênios vinculados às contas tocadas:
  // Saldo Fonte = Saldo Anterior (snapshot do BT) + depósitos − anulações,
  // filtrando SEMPRE por conta do convênio E fonte_orcamentaria exata.
  // Recarrega a lista de convênios APENAS quando alguma fonte mudou.
  const recalcFontesConvenio = async (contasTocadas: string[]) => {
    if (!currentBt) return;
    const afetados = await recalcConveniosPorContas(currentBt.id, convenios, contasTocadas);
    if (afetados > 0) setConvenios(await listConvenios());
  };

  const startEditDeposito = (tx: Transaction) => {
    setEditingDep(tx.id);
    setDepAccountId(tx.account_id);
    // natureza gravada; fallback no texto antigo quando a coluna é nula
    setDepKind(tx.natureza ?? (tx.descricao.toLowerCase().includes('anula') ? 'anulacao' : 'deposito'));
    setDepValor(tx.valor);
    setDepData(tx.data_lancamento || todayISO());
    setDepDescricao(tx.descricao);
    setDepFonte(tx.fonte_orcamentaria ?? '');
  };

  const deleteDeposito = async (tx: Transaction) => {
    await deleteTransaction(tx.id);
    if (editingDep === tx.id) {
      setEditingDep(null);
      setDepValor(null);
      setDepDescricao('');
    }
    await recalcAccountSaldos(tx.account_id);
    await recalcFontesConvenio([tx.account_id]);
    fetchTransactions();
  };

  // Migra anulações antigas gravadas como saída para entrada (estorno credita a conta)
  const migrateOldAnulacoes = async () => {
    const antigas = transactions.filter(t => t.tipo === 'deposito_anulacao' && t.tipo_movimento === 'saida');
    for (const tx of antigas) {
      await updateTransaction(tx.id, { tipo_movimento: 'entrada' });
    }
    if (antigas.length > 0) {
      const contas = new Set(antigas.map(t => t.account_id));
      for (const accId of contas) await recalcAccountSaldos(accId);
      fetchTransactions();
    }
  };

  useEffect(() => {
    migrateOldAnulacoes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions]);

  const depositos = useMemo(() =>
    transactions.filter(t => t.tipo === 'deposito_anulacao'),
  [transactions]);

  const totalGeral = accounts.filter(a => a.ativo).reduce((sum, acc) => sum + getAccountSubtotal(acc.id), 0);
  const totalTransferencias = Array.from(transferenciasPorConta.values()).reduce((s, v) => s + v, 0);
  const totaisPorColuna = accounts.filter(a => a.ativo).reduce(
    (acc, a) => {
      const row = inputs[a.id];
      if (!row) return acc;
      return {
        vigente: acc.vigente + toDecimal(row.vigente || 0).toNumber(),
        restos_pagar: acc.restos_pagar + toDecimal(row.restos_pagar || 0).toNumber(),
        diversos_credores: acc.diversos_credores + toDecimal(row.diversos_credores || 0).toNumber(),
      };
    },
    { vigente: 0, restos_pagar: 0, diversos_credores: 0 }
  );
  const totalSaldoFinal = accounts.filter(a => a.ativo).reduce((sum, acc) => sum + getAccountSaldoFinal(acc.id), 0);

  const transferLivrePairs = useMemo(() => {
    const saidas = transactions.filter(t => t.tipo === 'transf_livre' && t.tipo_movimento === 'saida');
    const entradas = transactions.filter(t => t.tipo === 'transf_livre' && t.tipo_movimento === 'entrada');
    return saidas
      .map(saida => ({
        saida,
        entrada: entradas.find(e => e.valor === saida.valor && e.data_lancamento === saida.data_lancamento),
      }))
      .filter(p => p.entrada != null) as { saida: Transaction; entrada: Transaction }[];
  }, [transactions]);

  const repasses = useMemo(() =>
    transactions.filter(t => t.tipo === 'repasse_reitoria' && t.tipo_movimento === 'entrada'),
  [transactions]);

  if (!currentBt) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Nenhum BT ativo" description="Crie um novo Boletim de Tesouraria para começar a registrar movimentações." />
      </div>
    );
  }

  const activeAccounts = sortAccounts(accounts.filter(a => a.ativo));

  return (
    <>
    {fechado && <div className="px-6 pt-4"><BtFechadoBanner numero={currentBt.numero} /></div>}
    <BtFechadoGuard fechado={fechado}>
    <div className="p-6 space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-xs text-slate-500">Total de Pagamentos no Período</p>
          <p className="text-base font-bold text-amber-700">{formatCurrency(totalGeral)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Repasses / Transferências</p>
          <p className={`text-base font-bold ${totalTransferencias < 0 ? 'text-red-700' : 'text-blue-700'}`}>{formatCurrency(totalTransferencias)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Contas Ativas</p>
          <p className="text-base font-bold text-blue-700">{activeAccounts.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Status do BT</p>
          <p className="text-base font-bold text-slate-700 capitalize">{currentBt.status}</p>
        </Card>
      </div>

      {/* Saved flash */}
      {savedFlash && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 font-medium">
          <Check className="w-4 h-4" /> {savedFlash}
        </div>
      )}
      {transferFlash && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 font-medium">
          <Check className="w-4 h-4" /> {transferFlash}
        </div>
      )}
      {transferError && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 font-medium">
          {transferError}
        </div>
      )}

      {/* Spreadsheet-style direct input */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Lançamento de Movimentações</h3>
            <p className="text-xs text-slate-500 mt-0.5">Digite os valores diretamente. Use TAB para navegar entre os campos.</p>
          </div>
          <Button onClick={handleSave} disabled={fechado}>
            <Save className="w-4 h-4" /> Salvar
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <th className="px-4 py-2.5 text-left font-semibold w-64">Conta</th>
                <th className="px-4 py-2.5 text-right font-semibold">Orçamento Vigente</th>
                <th className="px-4 py-2.5 text-right font-semibold">Restos a Pagar</th>
                <th className="px-4 py-2.5 text-right font-semibold">Diversos Credores</th>
                <th className="px-4 py-2.5 text-right font-semibold">Repasse / Transferências</th>
                <th className="px-4 py-2.5 text-right font-semibold">Sub-Total</th>
                <th className="px-4 py-2.5 text-right font-semibold">Saldo Final</th>
              </tr>
            </thead>
            <tbody>
              {activeAccounts.map(acc => {
                const row = inputs[acc.id] || { vigente: '', restos_pagar: '', diversos_credores: '' };
                const transf = transferenciasPorConta.get(acc.id) ?? 0;
                const saldoFinal = getAccountSaldoFinal(acc.id);
                const saldoAnterior = getAccountSaldoAnterior(acc.id);
                return (
                  <tr key={acc.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-2">
                      <p className="text-sm font-medium text-slate-700">{acc.nome}</p>
                      <p className="text-xs text-slate-400">{acc.codigo} · Saldo Ant: {formatCurrency(saldoAnterior)}</p>
                    </td>
                    {(['vigente', 'restos_pagar', 'diversos_credores'] as const).map((field) => {
                      const refKey = `${acc.id}-${field}`;
                      return (
                        <td key={field} className="px-2 py-2 text-right">
                          <MoneyInput
                            inputRef={(el) => { inputRefs.current[refKey] = el; }}
                            value={row[field] ? parseFloat(row[field]) : null}
                            onValueChange={(v) => handleInputChange(acc.id, field, v ? String(v) : '')}
                            disabled={fechado}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const allKeys = Object.keys(inputRefs.current).sort();
                                const currentIdx = allKeys.indexOf(refKey);
                                const nextKey = allKeys[currentIdx + 1];
                                if (nextKey && inputRefs.current[nextKey]) {
                                  inputRefs.current[nextKey]?.focus();
                                }
                              }
                            }}
                            placeholder="0,00"
                            className="w-28 px-2 py-1.5 text-sm"
                          />
                        </td>
                      );
                    })}
                    <td className={`px-4 py-2 text-right font-semibold ${transf < 0 ? 'text-red-700' : transf > 0 ? 'text-blue-700' : 'text-slate-400'}`}>
                      {formatCurrency(transf)}
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-slate-700 bg-slate-50/50">
                      {formatCurrency(getAccountSubtotal(acc.id))}
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-slate-800 bg-blue-50/30">
                      {formatCurrency(saldoFinal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-100 font-bold">
                <td className="px-4 py-3 text-slate-800">TOTAL GERAL</td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCurrency(totaisPorColuna.vigente)}</td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCurrency(totaisPorColuna.restos_pagar)}</td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCurrency(totaisPorColuna.diversos_credores)}</td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCurrency(totalTransferencias)}</td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCurrency(totalGeral)}</td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCurrency(totalSaldoFinal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Módulos simples de lançamento — protegidos pela barreira de alterações não salvas */}
      <div
        className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start"
        onClickCapture={interceptIfDirty}
        onFocusCapture={handleFocusCapture}
      >
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <Landmark className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800">Repasse da Reitoria</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            O valor é creditado na Conta Tesouro e aparece na coluna Repasse / Transferências.
          </p>
          <Field label="Valor do repasse (R$)">
            <MoneyInput value={repasseValor} onValueChange={setRepasseValor} className="w-full px-3 py-2 text-sm" />
          </Field>
          <div className="flex justify-end mt-4">
            {editingRepasse && (
              <Button size="sm" variant="ghost" onClick={() => { setEditingRepasse(null); setRepasseValor(null); }}>
                <X className="w-4 h-4" /> Cancelar Edição
              </Button>
            )}
            <Button size="sm" onClick={handleSaveRepasse} disabled={savingTransfer || !repasseValor || repasseValor <= 0}>
              {savingTransfer ? 'Registrando...' : editingRepasse ? 'Atualizar Repasse' : 'Registrar Repasse'}
            </Button>
          </div>

          {repasses.length > 0 && (
            <div className="mt-5 border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Repasses Registrados</h4>
                <span className="text-xs font-bold text-emerald-700">Total: {formatCurrency(repasses.reduce((s, r) => s + r.valor, 0))}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase tracking-wider bg-white">
                    <th className="px-3 py-2 text-left font-semibold">Data / Descrição</th>
                    <th className="px-3 py-2 text-right font-semibold">Valor</th>
                    <th className="px-3 py-2 text-center font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {repasses.map(r => (
                    <tr
                      key={r.id}
                      className={`border-t border-slate-100 ${editingRepasse?.id === r.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-3 py-2 text-slate-700">
                        <span className="font-medium">{formatDate(r.data_lancamento)}</span>
                        <span className="text-slate-500"> · {r.descricao}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-700">{formatCurrency(r.valor)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => startEditRepasse(r)}
                            disabled={fechado}
                            className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-40"
                            title="Editar"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteRepasse(r)}
                            disabled={fechado}
                            className="p-1.5 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
                            title="Excluir"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <Shuffle className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">Transferência Livre entre Contas</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            O valor sai da Conta Origem (débito) e entra na Conta Destino (crédito). Valores negativos invertem o movimento.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Conta Origem">
              <Select value={livreOrigem} onChange={(e) => setLivreOrigem(e.target.value)}>
                <option value="">Selecione...</option>
                {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </Select>
            </Field>
            <Field label="Conta Destino">
              <Select value={livreDestino} onChange={(e) => setLivreDestino(e.target.value)}>
                <option value="">Selecione...</option>
                {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </Select>
            </Field>
            <Field label="Valor (R$)">
              <MoneyInput value={livreValor} onValueChange={setLivreValor} className="w-full px-3 py-2 text-sm" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            {editingTransfer && (
              <Button size="sm" variant="ghost" onClick={() => { setEditingTransfer(null); setLivreOrigem(''); setLivreDestino(''); setLivreValor(null); }}>
                <X className="w-4 h-4" /> Cancelar Edição
              </Button>
            )}
            <Button size="sm" onClick={handleSaveLivre} disabled={savingTransfer || !livreValor || livreValor === 0}>
              {savingTransfer ? 'Registrando...' : editingTransfer ? 'Atualizar Transferência' : 'Registrar Transferência'}
            </Button>
          </div>

          {transferLivrePairs.length > 0 && (
            <div className="mt-5 border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Transferências Registradas</h4>
              </div>              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase tracking-wider bg-white">
                    <th className="px-3 py-2 text-left font-semibold">Conta Origem</th>
                    <th className="px-3 py-2 text-left font-semibold">Conta Destino</th>
                    <th className="px-3 py-2 text-right font-semibold">Valor</th>
                    <th className="px-3 py-2 text-center font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {transferLivrePairs.map(p => (
                    <tr
                      key={p.saida.id}
                      className={`border-t border-slate-100 ${editingTransfer?.ids.includes(p.saida.id) ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-3 py-2 text-slate-700">{accounts.find(a => a.id === p.saida.account_id)?.nome ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-700">{accounts.find(a => a.id === p.entrada.account_id)?.nome ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-blue-700">{formatCurrency(p.saida.valor)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => startEditTransfer(p)}
                            disabled={fechado}
                            className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-40"
                            title="Editar"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteTransfer(p)}
                            disabled={fechado}
                            className="p-1.5 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
                            title="Excluir"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDownToLine className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold text-slate-800">Depósitos / Anulações</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Depósito e anulação creditam a conta escolhida (anulação é estorno de despesa). Em contas de convênio, selecione também a Fonte Orçamentária (5/45/4/44) — o valor reflete no Controle de Convênios.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Conta">
              <Select value={depAccountId} onChange={(e) => { setDepAccountId(e.target.value); setDepFonte(''); }}>
                <option value="">Selecione...</option>
                {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </Select>
            </Field>
            <Field label="Tipo">
              <Select value={depKind} onChange={(e) => setDepKind(e.target.value as 'deposito' | 'anulacao')}>
                <option value="deposito">Depósito / Entrada</option>
                <option value="anulacao">Anulação</option>
              </Select>
            </Field>
            {isContaConvenio && (
              <Field label="Fonte Orçamentária *">
                <Select
                  value={depFonte}
                  onChange={(e) => setDepFonte(e.target.value as FonteOrcamentaria | '')}
                  required
                >
                  <option value="">Selecione a fonte...</option>
                  <option value="fonte_5">Fonte 5 — Convênio</option>
                  <option value="fonte_45">Fonte 45 — Convênio Superávit</option>
                  <option value="fonte_4">Fonte 4 — Contrapartida</option>
                  <option value="fonte_44">Fonte 44 — Contrapartida Superávit</option>
                </Select>
              </Field>
            )}
            <Field label="Valor (R$)">
              <MoneyInput value={depValor} onValueChange={setDepValor} className="w-full px-3 py-2 text-sm" />
            </Field>
            <Field label="Data">
              <input
                type="date"
                value={depData}
                onChange={(e) => setDepData(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </Field>
            <Field label="Descrição" className="md:col-span-2">
              <input
                type="text"
                value={depDescricao}
                onChange={(e) => setDepDescricao(e.target.value)}
                placeholder="Ex: Depósito em conta movimento"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            {editingDep && (
              <Button size="sm" variant="ghost" onClick={() => { setEditingDep(null); setDepAccountId(''); setDepKind('deposito'); setDepValor(null); setDepData(todayISO()); setDepDescricao(''); }}>
                <X className="w-4 h-4" /> Cancelar Edição
              </Button>
            )}
            <Button size="sm" onClick={handleSaveDeposito} disabled={savingTransfer || !depAccountId || !depValor || depValor === 0 || (isContaConvenio && !depFonte)}>
              {savingTransfer ? 'Registrando...' : editingDep ? 'Atualizar Lançamento' : 'Registrar'}
            </Button>
          </div>

          {depositos.length > 0 && (
            <div className="mt-5 border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Histórico de Depósitos / Anulações</h4>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase tracking-wider bg-white">
                    <th className="px-3 py-2 text-left font-semibold">Conta</th>
                    <th className="px-3 py-2 text-left font-semibold">Tipo / Data / Descrição</th>
                    <th className="px-3 py-2 text-right font-semibold">Valor</th>
                    <th className="px-3 py-2 text-center font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {depositos.map(d => (
                    <tr
                      key={d.id}
                      className={`border-t border-slate-100 ${editingDep === d.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-3 py-2 text-slate-700">{accounts.find(a => a.id === d.account_id)?.nome ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-700">
                        {(() => {
                          const isAnul = d.natureza
                            ? d.natureza === 'anulacao'
                            : d.descricao.toLowerCase().includes('anula');
                          return (
                            <>
                              <span className={`font-semibold ${isAnul ? 'text-amber-700' : 'text-emerald-700'}`}>
                                {isAnul ? 'Anulação' : 'Depósito'}
                              </span>
                              <span className="text-slate-500"> · {formatDate(d.data_lancamento)} · {d.descricao}</span>
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold" style={{}}>
                        {(() => {
                          const isAnul = d.natureza
                            ? d.natureza === 'anulacao'
                            : d.descricao.toLowerCase().includes('anula');
                          return (
                            <span className={isAnul ? 'text-amber-700' : 'text-emerald-700'}>
                              {formatCurrency(d.valor)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => startEditDeposito(d)}
                            disabled={fechado}
                            className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-40"
                            title="Editar"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteDeposito(d)}
                            disabled={fechado}
                            className="p-1.5 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
                            title="Excluir"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Modal de alterações não salvas (entre módulos da aba) */}
      <Modal open={showModuleGuard} onClose={closeModuleGuard} title="Alterações não salvas" maxWidth="max-w-md">
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 font-medium">
              Você possui valores digitados no Lançamento de Movimentações que ainda não foram salvos. Deseja salvar antes de mudar de modal?
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1 flex-wrap">
            <Button
              onClick={async () => {
                closeModuleGuard();
                await handleSave();
                const action = pendingActionRef.current;
                pendingActionRef.current = null;
                if (action) action();
              }}
            >
              Salvar
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                discardInputs();
                closeModuleGuard();
                const action = pendingActionRef.current;
                pendingActionRef.current = null;
                if (action) action();
              }}
            >
              Sair sem Salvar
            </Button>
            <Button variant="ghost" onClick={closeModuleGuard}>
              Continuar Editando
            </Button>
          </div>
        </div>
      </Modal>

      <p className="text-xs text-slate-400 px-1">
        Dica: Use a tecla TAB para navegar rapidamente entre os campos. Pressione Enter para pular para o próximo campo. Clique em Salvar quando terminar. Os valores de Repasse / Transferências são registrados imediatamente, sem precisar clicar em Salvar.
      </p>
    </div>
    </BtFechadoGuard>
    </>
  );
}
