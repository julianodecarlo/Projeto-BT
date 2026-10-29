import { useEffect, useMemo, useRef, useState } from 'react';
import { Save, Pencil, Trash2, AlertTriangle, Check } from 'lucide-react';
import { Card, Button, EmptyState } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { formatCurrency, toDecimal } from '@/lib/format';
import type { Account, BudgetType, Convenio, FonteOrcamentaria, Transaction } from '@/types';
import {
  insertEntry,
  updateTransaction,
  deleteTransaction,
  recalcAccountSaldos,
} from '@/services/transactionService';
import { setUnsavedGuard, setUnsavedSaver, subscribeUnsavedGuard, hasUnsavedGuard } from '@/lib/unsavedGuard';

const FONTES: FonteOrcamentaria[] = ['fonte_5', 'fonte_45', 'fonte_4', 'fonte_44'];
const FONTES_LABEL: Record<FonteOrcamentaria, string> = {
  fonte_5: 'Fonte 5', fonte_45: 'Fonte 45', fonte_4: 'Fonte 4', fonte_44: 'Fonte 44',
};
const GRUPOS: { field: BudgetType; desc: string; label: string }[] = [
  { field: 'vigente', desc: 'Orçamento Vigente', label: 'Orçamento Vigente' },
  { field: 'restos_pagar', desc: 'Restos a Pagar', label: 'Restos a Pagar' },
  { field: 'diversos_credores', desc: 'Diversos Credores', label: 'Diversos Credores' },
];
const GUARD_ORIGIN = 'movimentacao_convenios';

type CellInputs = Record<BudgetType, Record<FonteOrcamentaria, string>>;

const emptyCells = (): CellInputs => ({
  vigente: { fonte_5: '', fonte_45: '', fonte_4: '', fonte_44: '' },
  restos_pagar: { fonte_5: '', fonte_45: '', fonte_4: '', fonte_44: '' },
  diversos_credores: { fonte_5: '', fonte_45: '', fonte_4: '', fonte_44: '' },
});

const toCents = (raw: string | undefined): number => {
  const s = String(raw ?? '').trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  if (isNaN(n) || n === 0) return 0;
  return Math.round(n * 100);
};

interface Props {
  btId: string;
  btData: string;
  fechado: boolean;
  convenioAccounts: Account[];
  convenios: Convenio[];
  transactions: Transaction[];
  onSaved: (contasTocadas: string[]) => Promise<void>;
}

export default function MovimentacaoConveniosCard({
  btId, btData, fechado, convenioAccounts, convenios, transactions, onSaved,
}: Props) {
  const [inputs, setInputs] = useState<Record<string, CellInputs>>({});
  const [savedSnapshot, setSavedSnapshot] = useState<Record<string, CellInputs>>({});
  const [aba, setAba] = useState<BudgetType>('vigente');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const convenioPorConta = useMemo(() => {
    const map = new Map<string, Convenio>();
    for (const c of convenios) {
      if (c.finance_account_id) map.set(c.finance_account_id, c);
    }
    return map;
  }, [convenios]);

  // Pagamentos salvos com fonte (histórico editável) e linhas legado (somente leitura)
  const pagamentos = useMemo(
    () => transactions.filter(t => t.tipo_movimento === 'saida' && t.tipo_orcamento != null && t.fonte_orcamentaria != null),
    [transactions]
  );
  const legado = useMemo(
    () => transactions.filter(t => t.tipo_movimento === 'saida' && t.tipo_orcamento != null && t.fonte_orcamentaria == null),
    [transactions]
  );

  // Estado "sujo" comparado ao snapshot gravado (usado também para o saver
  // global e para NÃO sobrescrever digitação em andamento).
  const hasUnsaved = useMemo(
    () => Object.keys(inputs).some(accId => {
      const row = inputs[accId];
      const saved = savedSnapshot[accId] ?? emptyCells();
      return GRUPOS.some(g => FONTES.some(f => toCents(row?.[g.field]?.[f]) !== toCents(saved[g.field][f])));
    }),
    [inputs, savedSnapshot]
  );
  const hasUnsavedRef = useRef(false);
  hasUnsavedRef.current = hasUnsaved;

  // Snapshot do que está gravado; inputs refletem o banco SOMENTE quando não há
  // digitação pendente — recarregar a lista pelo pai nunca apaga o que foi
  // digitado e ainda não salvo.
  useEffect(() => {
    const state: Record<string, CellInputs> = {};
    for (const acc of convenioAccounts) state[acc.id] = emptyCells();
    for (const tx of pagamentos) {
      if (!state[tx.account_id]) state[tx.account_id] = emptyCells();
      state[tx.account_id][tx.tipo_orcamento as BudgetType][tx.fonte_orcamentaria as FonteOrcamentaria] = String(tx.valor || '');
    }
    setSavedSnapshot(state);
    setInputs(prev => {
      if (!hasUnsavedRef.current) return state;
      // Preserva células digitadas; células novas/vazias ficam do snapshot.
      const merged: Record<string, CellInputs> = {};
      for (const accId of Object.keys(state)) {
        const prevRow = prev[accId];
        merged[accId] = state[accId];
        if (prevRow) {
          for (const g of GRUPOS) {
            for (const f of FONTES) {
              const prevVal = prevRow[g.field]?.[f] ?? '';
              if (toCents(prevVal) !== toCents(state[accId][g.field][f])) merged[accId][g.field][f] = prevVal;
            }
          }
        }
      }
      return merged;
    });
    if (!hasUnsavedRef.current) setUnsavedGuard(GUARD_ORIGIN, false);
  }, [convenioAccounts, pagamentos]);

  useEffect(() => {
    setUnsavedGuard(GUARD_ORIGIN, hasUnsaved);
  }, [hasUnsaved]);

  useEffect(() => () => setUnsavedGuard(GUARD_ORIGIN, false), []);

  const handleSaveRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    return setUnsavedSaver(GUARD_ORIGIN, async () => {
      await handleSaveRef.current();
      return !hasUnsavedGuard();
    });
  }, []);

  // Descarga externa (barreira global descartou tudo): volta ao snapshot.
  const guardWasDirty = useRef(false);
  useEffect(() => {
    return subscribeUnsavedGuard(() => {
      const dirtyNow = hasUnsavedGuard();
      if (guardWasDirty.current && !dirtyNow && !hasUnsavedRef.current) {
        setInputs(savedSnapshot);
      }
      guardWasDirty.current = dirtyNow;
    });
  }, [savedSnapshot]);

  const handleInputChange = (accId: string, field: BudgetType, fonte: FonteOrcamentaria, value: string) => {
    setInputs(prev => ({
      ...prev,
      [accId]: {
        ...emptyCells(),
        ...prev[accId],
        [field]: { ...(prev[accId]?.[field] ?? emptyCells()[field]), [fonte]: value },
      },
    }));
  };

  const projectedSaldo = (conv: Convenio, fonte: FonteOrcamentaria): number => {
    const digitado = GRUPOS.reduce((s, g) => s + toCents(inputs[conv.finance_account_id ?? '']?.[g.field]?.[fonte]), 0) / 100;
    return toDecimal(conv[fonte]).minus(digitado).toNumber();
  };

  // Aviso (não bloqueio): fontes que ficariam negativas com a digitação atual.
  const fontesNegativasGerais = useMemo(() => {
    const neg: string[] = [];
    for (const acc of convenioAccounts) {
      const conv = convenioPorConta.get(acc.id);
      if (!conv) continue;
      for (const fonte of FONTES) {
        if (projectedSaldo(conv, fonte) < 0) neg.push(`${conv.nome} — ${FONTES_LABEL[fonte]}`);
      }
    }
    return neg;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convenioAccounts, convenioPorConta, inputs]);

  const handleSave = async () => {
    if (fechado || convenioAccounts.length === 0) return;
    setSaving(true);
    setError(null);
    const touched = new Set<string>();
    let failed = false;

    for (const acc of convenioAccounts) {
      for (const g of GRUPOS) {
        for (const fonte of FONTES) {
          const raw = inputs[acc.id]?.[g.field]?.[fonte];
          const v = raw && parseFloat(raw) > 0 ? toDecimal(raw).toNumber() : 0;
          const existing = pagamentos.find(
            t => t.account_id === acc.id && t.tipo_orcamento === g.field && t.fonte_orcamentaria === fonte
          );

          if (v === 0) {
            if (existing) {
              const ok = await deleteTransaction(existing.id);
              if (!ok) { failed = true; break; }
              touched.add(acc.id);
            }
            continue;
          }
          if (existing) {
            if (existing.valor !== v) {
              const ok = await updateTransaction(existing.id, { valor: v });
              if (!ok) { failed = true; break; }
              touched.add(acc.id);
            }
          } else {
            const ok = await insertEntry({
              btReportId: btId,
              accountId: acc.id,
              descricao: g.desc,
              tipoMovimento: 'saida',
              valor: v,
              dataLancamento: btData,
              tipoOrcamento: g.field,
              fonteOrcamentaria: fonte,
            });
            if (!ok) { failed = true; break; }
            touched.add(acc.id);
          }
        }
        if (failed) break;
      }
      if (failed) break;
    }

    if (failed) {
      setError('Não foi possível salvar os lançamentos de convênio. Verifique e tente novamente.');
      setSaving(false);
      return;
    }

    for (const accId of touched) {
      const saldoInicial = convenioAccounts.find(a => a.id === accId)?.saldo_inicial ?? 0;
      await recalcAccountSaldos(btId, accId, saldoInicial);
    }
    await onSaved(Array.from(touched));
    setSaving(false);
    setEditing(null);
    setFlash('Movimentações de convênio salvas com sucesso!');
    setTimeout(() => setFlash(null), 3000);
  };
  handleSaveRef.current = handleSave;

  const startEdit = (tx: Transaction) => {
    setEditing(tx.id);
    setAba((tx.tipo_orcamento ?? 'vigente') as BudgetType);
    setInputs(prev => ({
      ...prev,
      [tx.account_id]: {
        ...emptyCells(),
        ...prev[tx.account_id],
        [tx.tipo_orcamento as BudgetType]: {
          ...(prev[tx.account_id]?.[tx.tipo_orcamento as BudgetType] ?? emptyCells()[tx.tipo_orcamento as BudgetType]),
          [tx.fonte_orcamentaria as FonteOrcamentaria]: String(tx.valor || ''),
        },
      },
    }));
  };

  const deletePagamento = async (tx: Transaction) => {
    const ok = await deleteTransaction(tx.id);
    if (!ok) {
      setError('Não foi possível excluir o lançamento. Tente novamente.');
      return;
    }
    if (editing === tx.id) setEditing(null);
    await recalcAccountSaldos(btId, tx.account_id, convenioAccounts.find(a => a.id === tx.account_id)?.saldo_inicial ?? 0);
    await onSaved([tx.account_id]);
  };

  // Contador por aba: valor digitado não salvo OU já gravado no BT.
  const abasComValor = useMemo(() => {
    const set = new Set<BudgetType>();
    for (const p of pagamentos) set.add(p.tipo_orcamento as BudgetType);
    for (const accId of Object.keys(inputs)) {
      for (const g of GRUPOS) {
        if (FONTES.some(f => toCents(inputs[accId]?.[g.field]?.[f]) !== 0)) set.add(g.field);
      }
    }
    return set;
  }, [pagamentos, inputs]);

  const totalASalvar = useMemo(
    () => Object.keys(inputs).reduce((s, accId) =>
      s + GRUPOS.reduce((s2, g) => s2 + FONTES.reduce((s3, f) => s3 + toCents(inputs[accId]?.[g.field]?.[f]), 0), 0), 0) / 100,
    [inputs]
  );

  const totalAba = useMemo(
    () => convenioAccounts.reduce((s, acc) => s + FONTES.reduce((s2, f) => s2 + toCents(inputs[acc.id]?.[aba]?.[f]), 0), 0) / 100,
    [convenioAccounts, inputs, aba]
  );

  if (convenioAccounts.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Lançamento de Movimentações - Convênios</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Pagamentos por Fonte Orçamentária (5/45/4/44). O valor digitado reduz o saldo da fonte correspondente.
          </p>
        </div>
        <Button onClick={handleSave} disabled={fechado || saving}>
          <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>

      {error && (
        <div className="px-4 py-2.5 bg-red-50 border-b border-red-200 text-sm text-red-700 font-medium">{error}</div>
      )}
      {flash && (
        <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200 text-sm text-emerald-700 font-medium flex items-center gap-2">
          <Check className="w-4 h-4" /> {flash}
        </div>
      )}
      {fontesNegativasGerais.length > 0 && (
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Atenção: os valores digitados deixam o saldo negativo de: {fontesNegativasGerais.join('; ')}.</span>
        </div>
      )}

      {/* Abas por grupo orçamentário: o estado é único (trocar de aba nunca perde valores) */}
      <div className="px-4 pt-3 border-b border-slate-200 flex gap-1">
        {GRUPOS.map(g => {
          const active = aba === g.field;
          const temValor = abasComValor.has(g.field);
          return (
            <button
              key={g.field}
              onClick={() => setAba(g.field)}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
                active
                  ? 'text-blue-700 border-blue-600 bg-blue-50/50'
                  : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {g.label}
              {temValor && !active && (
                <span className="w-2 h-2 rounded-full bg-amber-500" title="Há valores nesta aba" />
              )}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <th className="px-4 py-2 text-left font-semibold w-56">Conta / Convênio</th>
              {FONTES.map(f => (
                <th key={f} className="px-2 py-2 text-right font-semibold">{FONTES_LABEL[f]}</th>
              ))}
              <th className="px-3 py-2 text-right font-semibold bg-slate-100/70">Total</th>
            </tr>
          </thead>
          <tbody>
            {convenioAccounts.map(acc => {
              const conv = convenioPorConta.get(acc.id);
              const totalLinha = FONTES.reduce((s, f) => s + toCents(inputs[acc.id]?.[aba]?.[f]), 0) / 100;
              return (
                <tr key={acc.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-4 py-1.5">
                    <p className="text-sm font-medium text-slate-700 whitespace-nowrap">{acc.nome}</p>
                  </td>
                  {FONTES.map(f => {
                    const proj = conv ? projectedSaldo(conv, f) : null;
                    return (
                      <td key={`${acc.id}-${aba}-${f}`} className="px-2 py-1.5 text-right">
                        <MoneyInput
                          value={inputs[acc.id]?.[aba]?.[f] ? parseFloat(inputs[acc.id][aba][f]) : null}
                          onValueChange={(v) => handleInputChange(acc.id, aba, f, v ? String(v) : '')}
                          disabled={fechado}
                          placeholder="0,00"
                          className="w-24 px-1.5 py-1.5 text-xs"
                        />
                        {proj != null && (
                          <p className={`text-[10px] mt-0.5 ${proj < 0 ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>
                            Saldo: {formatCurrency(proj)}
                          </p>
                        )}
                      </td>
                    );
                  })}
                  <td className={`px-3 py-1.5 text-right font-bold bg-slate-100/50 ${totalLinha > 0 ? 'text-slate-700' : 'text-slate-400'}`}>
                    {formatCurrency(totalLinha)}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-200 bg-slate-100 font-bold">
              <td className="px-4 py-2 text-xs text-slate-800 uppercase tracking-wide">Total da aba</td>
              {FONTES.map(f => {
                const tot = convenioAccounts.reduce((s, acc) => s + toCents(inputs[acc.id]?.[aba]?.[f]), 0) / 100;
                return (
                  <td key={`tot-${f}`} className="px-2 py-2 text-right text-xs text-slate-800">{formatCurrency(tot)}</td>
                );
              })}
              <td className="px-3 py-2 text-right text-xs text-slate-800 bg-slate-200/50">{formatCurrency(totalAba)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Rodapé: total geral das três abas */}
      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">
          Total a salvar neste BT: <span className="text-slate-800">{formatCurrency(totalASalvar)}</span>
        </p>
      </div>

      {/* Histórico de pagamentos por fonte (editável) */}
      {pagamentos.length > 0 && (
        <div className="m-4 border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Pagamentos por Fonte Registrados</h4>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wider bg-white">
                <th className="px-3 py-2 text-left font-semibold">Conta</th>
                <th className="px-3 py-2 text-left font-semibold">Grupo</th>
                <th className="px-3 py-2 text-left font-semibold">Fonte</th>
                <th className="px-3 py-2 text-right font-semibold">Valor</th>
                <th className="px-3 py-2 text-center font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {pagamentos.map(p => (
                <tr key={p.id} className={`border-t border-slate-100 ${editing === p.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                  <td className="px-3 py-2 text-slate-700">{convenioAccounts.find(a => a.id === p.account_id)?.nome ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{GRUPOS.find(g => g.field === p.tipo_orcamento)?.label ?? p.tipo_orcamento}</td>
                  <td className="px-3 py-2 font-semibold text-blue-700">{FONTES_LABEL[p.fonte_orcamentaria as FonteOrcamentaria]}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-700">{formatCurrency(p.valor)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => startEdit(p)} disabled={fechado} className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-40" title="Editar">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deletePagamento(p)} disabled={fechado} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40" title="Excluir">
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

      {/* Linhas antigas sem fonte: somente leitura */}
      {legado.length > 0 && (
        <div className="mx-4 mb-4 border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Sem fonte (legado) — somente leitura</h4>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {legado.map(t => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{convenioAccounts.find(a => a.id === t.account_id)?.nome ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{GRUPOS.find(g => g.field === t.tipo_orcamento)?.label ?? t.tipo_orcamento}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-500">{formatCurrency(t.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagamentos.length === 0 && legado.length === 0 && (
        <div className="p-4">
          <EmptyState icon={Save} title="Nenhum pagamento por fonte" description="Digite os valores nas colunas de fonte e clique em Salvar." />
        </div>
      )}
    </Card>
  );
}
