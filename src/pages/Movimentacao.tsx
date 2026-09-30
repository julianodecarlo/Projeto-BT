import { useEffect, useState, useCallback, useRef } from 'react';
import { Save, FileText, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import { Card, Button, EmptyState } from '@/components/ui/Field';
import { formatCurrency, toDecimal, toNumber, sumDecimal } from '@/lib/format';
import type { Transaction, BudgetType, Account } from '@/types';

const budgetTypes: { value: BudgetType; label: string }[] = [
  { value: 'vigente', label: 'Orçamento Vigente' },
  { value: 'restos_pagar', label: 'Restos a Pagar' },
  { value: 'diversos_credores', label: 'Diversos Credores' },
];

interface RowInput {
  vigente: string;
  restos_pagar: string;
  diversos_credores: string;
}

export default function Movimentacao() {
  const { currentBt, accounts } = useBt();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [inputs, setInputs] = useState<Record<string, RowInput>>({});
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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
    // Saldo anterior = saldo transposto na criação do BT (transação "Saldo Anterior")
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

  const getAccountSaldoFinal = (accId: string): number => {
    const subtotal = getAccountSubtotal(accId);
    return toDecimal(getAccountSaldoAnterior(accId)).minus(toDecimal(subtotal)).toNumber();
  };

  const handleInputChange = (accId: string, field: keyof RowInput, value: string) => {
    setInputs(prev => ({
      ...prev,
      [accId]: { ...prev[accId], [field]: value },
    }));
  };

  const handleSave = async () => {
    if (!currentBt) return;
    // Preserva a linha de abertura (Saldo Anterior transposto) e apaga o resto
    const aberturas = transactions.filter(t => t.descricao === 'Saldo Anterior');
    await supabase
      .from('transactions')
      .delete()
      .eq('bt_report_id', currentBt.id)
      .neq('descricao', 'Saldo Anterior');

    const newTxs: Transaction[] = [...aberturas];
    let ordem = 1;
    const saldoAnteriorMap: Record<string, number> = {};
    for (const acc of accounts) {
      const abertura = aberturas.find(t => t.account_id === acc.id);
      saldoAnteriorMap[acc.id] = abertura ? abertura.saldo_anterior : getAccountSaldoAnterior(acc.id);
    }

    for (const acc of accounts.filter(a => a.ativo)) {
      const row = inputs[acc.id];
      if (!row) continue;
      const entries: { field: keyof RowInput; tipo: BudgetType | null; desc: string }[] = [
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
          const { data, error } = await supabase.from('transactions').insert({
            bt_report_id: currentBt.id,
            account_id: acc.id,
            descricao: entry.desc,
            tipo_orcamento: entry.tipo,
            tipo_movimento: 'saida',
            valor: v.toNumber(),
            saldo_anterior: saldoAnt,
            saldo_final: saldoFin,
            data_lancamento: currentBt.data,
            ordem: ++ordem,
          }).select().single();
          if (!error && data) {
            newTxs.push(data as Transaction);
            saldoAnteriorMap[acc.id] = saldoFin;
          }
        }
      }
    }

    setTransactions(newTxs);
    setSavedFlash('Movimentações salvas com sucesso!');
    setTimeout(() => setSavedFlash(null), 3000);
  };

  const totalGeral = accounts.filter(a => a.ativo).reduce((sum, acc) => sum + getAccountSubtotal(acc.id), 0);
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
    <div className="p-6 space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-xs text-slate-500">Total de Pagamentos no Período</p>
          <p className="text-base font-bold text-amber-700">{formatCurrency(totalGeral)}</p>
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

      {/* Spreadsheet-style direct input */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Lançamento de Movimentações</h3>
            <p className="text-xs text-slate-500 mt-0.5">Digite os valores diretamente. Use TAB para navegar entre os campos.</p>
          </div>
          <Button onClick={handleSave}>
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
                <th className="px-4 py-2.5 text-right font-semibold">Sub-Total</th>
                <th className="px-4 py-2.5 text-right font-semibold">Saldo Final</th>
              </tr>
            </thead>
            <tbody>
              {activeAccounts.map(acc => {
                const row = inputs[acc.id] || { vigente: '', restos_pagar: '', diversos_credores: '' };
                const subtotal = getAccountSubtotal(acc.id);
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
                          <input
                            ref={(el) => { inputRefs.current[refKey] = el; }}
                            type="number"
                            step="0.01"
                            value={row[field]}
                            onChange={(e) => handleInputChange(acc.id, field, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                // Find next input and focus it
                                const allKeys = Object.keys(inputRefs.current).sort();
                                const currentIdx = allKeys.indexOf(refKey);
                                const nextKey = allKeys[currentIdx + 1];
                                if (nextKey && inputRefs.current[nextKey]) {
                                  inputRefs.current[nextKey]?.focus();
                                }
                              }
                            }}
                            placeholder="0,00"
                            tabIndex={++tabIndex}
                            className="w-28 px-2 py-1.5 text-sm text-right border border-slate-300 rounded-md outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors"
                          />
                        </td>
                      );
                    })}
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
                <td className="px-4 py-3 text-right text-slate-800">{formatCurrency(totalGeral)}</td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCurrency(totalSaldoFinal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <p className="text-xs text-slate-400 px-1">
        Dica: Use a tecla TAB para navegar rapidamente entre os campos. Pressione Enter para pular para o próximo campo. Clique em Salvar quando terminar.
      </p>
    </div>
  );
}
