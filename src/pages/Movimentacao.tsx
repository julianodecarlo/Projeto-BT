import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Save, FileText, Check, Landmark, Shuffle, Pencil, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import { Card, Button, EmptyState, Field, Select } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { formatCurrency, toDecimal, toNumber, sumDecimal } from '@/lib/format';
import type { Transaction, BudgetType } from '@/types';
import { BtFechadoGuard, BtFechadoBanner } from '@/components/BtFechadoGuard';

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

  const fetchTransactions = useCallback(async () => {
    if (!currentBt) return;
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .eq('bt_report_id', currentBt.id)
      .order('ordem', { ascending: true });
    if (data) {
      setTransactions(data as Transaction[]);
      buildInputState(data as Transaction[]);
    }
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
    setInputs(state);
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
      setInputs(state);
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

  // Soma líquida das transferências (repasse, livre) por conta a partir das transações
  const transferenciasPorConta = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.tipo === 'repasse_reitoria' || tx.tipo === 'transf_livre' || tx.tipo === 'transf_tesouro_receita' || tx.tipo === 'transf_tesouro_diarias') {
      const atual = transferenciasPorConta.get(tx.account_id) ?? 0;
      transferenciasPorConta.set(
        tx.account_id,
        tx.tipo_movimento === 'entrada' ? atual + tx.valor : atual - tx.valor
      );
    }
  }

  const getAccountSaldoFinal = (accId: string): number => {
    const subtotal = getAccountSubtotal(accId);
    const transf = transferenciasPorConta.get(accId) ?? 0;
    return toDecimal(getAccountSaldoAnterior(accId)).minus(toDecimal(subtotal)).plus(toDecimal(transf)).toNumber();
  };

  const handleInputChange = (accId: string, field: keyof RowInput, value: string) => {
    setInputs(prev => ({
      ...prev,
      [accId]: { ...prev[accId], [field]: value },
    }));
  };

  const handleSave = async () => {
    if (!currentBt) return;
    // Remove apenas as linhas das colunas orçamentárias; aberturas e transferências permanecem
    await supabase
      .from('transactions')
      .delete()
      .eq('bt_report_id', currentBt.id)
      .not('tipo_orcamento', 'is', null);

    const maxOrdem = transactions.length > 0 ? Math.max(...transactions.map(t => t.ordem ?? 0)) : 0;
    let ordem = maxOrdem + 1;
    const saldoAnteriorMap: Record<string, number> = {};
    for (const acc of accounts) {
      saldoAnteriorMap[acc.id] = getAccountSaldoAnterior(acc.id);
    }

    for (const acc of accounts.filter(a => a.ativo)) {
      const row = inputs[acc.id];
      if (!row) continue;
      const entries: { field: keyof RowInput; tipo: BudgetType; desc: string }[] = [
        { field: 'vigente', tipo: 'vigente', desc: 'Orçamento Vigente' },
        { field: 'restos_pagar', tipo: 'restos_pagar', desc: 'Restos a Pagar' },
        { field: 'diversos_credores', tipo: 'diversos_credores', desc: 'Diversos Credores' },
      ];

      for (const entry of entries) {
        const val = row[entry.field];
        if (val && parseFloat(val) > 0) {
          const v = toDecimal(val);
          const saldoAnt = saldoAnteriorMap[acc.id];
          const saldoFin = toDecimal(saldoAnt).minus(v).toNumber();
          await supabase.from('transactions').insert({
            bt_report_id: currentBt.id,
            account_id: acc.id,
            descricao: entry.desc,
            tipo_orcamento: entry.tipo,
            tipo_movimento: 'saida',
            valor: v.toNumber(),
            saldo_anterior: saldoAnt,
            saldo_final: saldoFin,
            data_lancamento: currentBt.data,
            ordem: ordem++,
          });
          saldoAnteriorMap[acc.id] = saldoFin;
        }
      }
    }

    // Recarrega do banco: os valores permanecem na tela como histórico e continuam editáveis
    await fetchTransactions();
    setSavedFlash('Movimentações salvas com sucesso!');
    setTimeout(() => setSavedFlash(null), 3000);
  };

  const insertTransfer = async (
    tipo: 'repasse_reitoria' | 'transf_livre',
    fromId: string | null,
    toId: string | null,
    valor: number,
    descricao: string
  ): Promise<boolean> => {
    if (!currentBt || valor <= 0) return false;

    const getSaldoAtual = async (accId: string): Promise<number> => {
      const { data: lastTx } = await supabase
        .from('transactions')
        .select('saldo_final')
        .eq('bt_report_id', currentBt.id)
        .eq('account_id', accId)
        .order('ordem', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastTx) return lastTx.saldo_final;
      const { data: accData } = await supabase.from('accounts').select('saldo_inicial').eq('id', accId).maybeSingle();
      return accData?.saldo_inicial ?? 0;
    };

    // Repasse: apenas credita a conta destino
    if (!fromId && toId) {
      const saldoAnt = await getSaldoAtual(toId);
      const { error } = await supabase.from('transactions').insert({
        bt_report_id: currentBt.id,
        account_id: toId,
        descricao,
        tipo_movimento: 'entrada',
        valor,
        saldo_anterior: saldoAnt,
        saldo_final: toDecimal(saldoAnt).plus(toDecimal(valor)).toNumber(),
        data_lancamento: currentBt.data,
        tipo,
      });
      return !error;
    }

    if (!fromId || !toId) return false;
    const saldoFrom = await getSaldoAtual(fromId);
    const saldoTo = await getSaldoAtual(toId);
    const { error: errFrom } = await supabase.from('transactions').insert({
      bt_report_id: currentBt.id,
      account_id: fromId,
      descricao,
      tipo_movimento: 'saida',
      valor,
      saldo_anterior: saldoFrom,
      saldo_final: toDecimal(saldoFrom).minus(toDecimal(valor)).toNumber(),
      data_lancamento: currentBt.data,
      tipo,
    });
    const { error: errTo } = await supabase.from('transactions').insert({
      bt_report_id: currentBt.id,
      account_id: toId,
      descricao,
      tipo_movimento: 'entrada',
      valor,
      saldo_anterior: saldoTo,
      saldo_final: toDecimal(saldoTo).plus(toDecimal(valor)).toNumber(),
      data_lancamento: currentBt.data,
      tipo,
    });
    return !errFrom && !errTo;
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
    const ok = await insertTransfer('repasse_reitoria', null, tesouro.id, repasseValor, 'Repasse Financeiro da Reitoria');
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

  const handleSaveLivre = async () => {
    if (!currentBt || !livreOrigem || !livreDestino || !livreValor || livreValor === 0) return;
    if (livreOrigem === livreDestino) {
      setTransferError('A conta origem e a conta destino devem ser diferentes.');
      return;
    }
    setSavingTransfer(true);
    setTransferError(null);
    // Na edição, remove o par antigo antes de registrar o novo
    if (editingTransfer) {
      await supabase.from('transactions').delete().in('id', editingTransfer.ids);
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
    await supabase.from('transactions').delete().in('id', ids);
    if (editingTransfer && ids.some(id => editingTransfer.ids.includes(id))) {
      setEditingTransfer(null);
      setLivreValor(null);
    }
    fetchTransactions();
  };

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

  if (!currentBt) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Nenhum BT ativo" description="Crie um novo Boletim de Tesouraria para começar a registrar movimentações." />
      </div>
    );
  }

  const activeAccounts = accounts.filter(a => a.ativo);
  let tabIndex = 0;

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
                const subtotal = getAccountSubtotal(acc.id) + transf;
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
                      {formatCurrency(subtotal)}
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
                <td className="px-4 py-3 text-right text-slate-800">{formatCurrency(totalGeral + totalTransferencias)}</td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCurrency(totalSaldoFinal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Módulos simples de lançamento */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
            <Button size="sm" onClick={handleSaveRepasse} disabled={savingTransfer || !repasseValor || repasseValor <= 0}>
              {savingTransfer ? 'Registrando...' : 'Registrar Repasse'}
            </Button>
          </div>
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
                {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </Select>
            </Field>
            <Field label="Conta Destino">
              <Select value={livreDestino} onChange={(e) => setLivreDestino(e.target.value)}>
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
              </div>
              <table className="w-full text-sm">
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
      </div>

      <p className="text-xs text-slate-400 px-1">
        Dica: Use a tecla TAB para navegar rapidamente entre os campos. Pressione Enter para pular para o próximo campo. Clique em Salvar quando terminar. Os valores de Repasse / Transferências são registrados imediatamente, sem precisar clicar em Salvar.
      </p>
    </div>
    </BtFechadoGuard>
    </>
  );
}
