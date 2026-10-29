import { useEffect, useMemo, useRef, useState } from 'react';
import { Save, Pencil, Trash2, AlertTriangle, Check } from 'lucide-react';
import { Card, Button, EmptyState } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { formatCurrency } from '@/lib/format';
import {
  buildSnapshot,
  buildSyncSignature,
  hasUnsaved,
  mergeTypedCells,
  projectedSaldoCents,
  setCell,
  totalCentsOf,
  fonteOf,
  type CellsByAccount,
} from '@/lib/convenioCardState';
import type { Account, BudgetType, Convenio, FonteOrcamentaria, Transaction } from '@/types';
import {
  insertEntry,
  updateTransaction,
  deleteTransaction,
  recalcAccountSaldos,
} from '@/services/transactionService';
import { setUnsavedGuard, setUnsavedSaver } from '@/lib/unsavedGuard';

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
  const [inputs, setInputs] = useState<CellsByAccount>({});
  const [savedSnapshot, setSavedSnapshot] = useState<CellsByAccount>({});
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

  const pagamentos = useMemo(
    () => transactions.filter(t => t.tipo_movimento === 'saida' && t.tipo_orcamento != null && t.fonte_orcamentaria != null),
    [transactions]
  );
  const legado = useMemo(
    () => transactions.filter(t => t.tipo_movimento === 'saida' && t.tipo_orcamento != null && t.fonte_orcamentaria == null),
    [transactions]
  );

  const convenioAccountIds = useMemo(() => convenioAccounts.map(a => a.id), [convenioAccounts]);
  const hasUnsavedRef = useRef(false);

  const isDirty = useMemo(() => hasUnsaved(inputs, savedSnapshot), [inputs, savedSnapshot]);
  hasUnsavedRef.current = isDirty;

  // Sincronização com o banco disparada SOMENTE por assinatura de conteúdo
  // (BT + contas + pagamentos gravados) — nunca por identidade de arrays.
  const syncSignature = useMemo(
    () => buildSyncSignature(btId, convenioAccountIds, pagamentos),
    [btId, convenioAccountIds, pagamentos]
  );
  const lastSyncSignature = useRef<string | null>(null);

  useEffect(() => {
    if (lastSyncSignature.current === syncSignature) return;
    lastSyncSignature.current = syncSignature;
    const snapshot = buildSnapshot(convenioAccountIds, pagamentos);
    setSavedSnapshot(snapshot);
    setInputs(prev => (hasUnsavedRef.current ? mergeTypedCells(prev, snapshot) : snapshot));
  }, [syncSignature, convenioAccountIds, pagamentos]);

  // Descarte explícito (barreira global pediu "descartar"): restaura o snapshot.
  // Nada de resets automáticos por listener — só quando o card for solicitado.
  useEffect(() => {
    setUnsavedGuard(GUARD_ORIGIN, isDirty);
  }, [isDirty]);

  useEffect(() => () => setUnsavedGuard(GUARD_ORIGIN, false), []);

  const handleSaveRef = useRef<() => Promise<void>>(async () => {});
  const discardRef = useRef<() => void>(() => {});
  useEffect(() => {
    return setUnsavedSaver(GUARD_ORIGIN, async () => {
      await handleSaveRef.current();
      return !hasUnsavedRef.current;
    });
  }, []);
  discardRef.current = () => {
    setInputs(savedSnapshot);
  };

  const handleInputChange = (accId: string, grupo: BudgetType, fonte: FonteOrcamentaria, cents: number) => {
    setInputs(prev => setCell(prev, accId, grupo, fonte, cents));
  };

  const projectedSaldo = (conv: Convenio, fonte: FonteOrcamentaria): number => {
    if (!conv.finance_account_id) return null as unknown as number;
    return projectedSaldoCents(fonteOf(conv, fonte), inputs, conv.finance_account_id, fonte) / 100;
  };

  const fontesNegativasGerais = useMemo(() => {
    const neg: string[] = [];
    for (const acc of convenioAccounts) {
      const conv = convenioPorConta.get(acc.id);
      if (!conv) continue;
      for (const fonte of FONTES) {
        const proj = projectedSaldo(conv, fonte);
        if (proj != null && proj < 0) neg.push(`${conv.nome} — ${FONTES_LABEL[fonte]}`);
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
          const cents = inputs[acc.id]?.[g.field]?.[fonte] ?? 0;
          const v = cents > 0 ? cents / 100 : 0;
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
    setInputs(prev =>
      setCell(
        prev,
        tx.account_id,
        tx.tipo_orcamento as BudgetType,
        tx.fonte_orcamentaria as FonteOrcamentaria,
        Math.round((tx.valor || 0) * 100)
      )
    );
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

  const abasComValor = useMemo(() => {
    const set = new Set<BudgetType>();
    for (const p of pagamentos) set.add(p.tipo_orcamento as BudgetType);
    for (const accId of Object.keys(inputs)) {
      for (const g of GRUPOS) {
        if (totalCentsOf(inputs, accId, g.field) !== 0) set.add(g.field);
      }
    }
    return set;
  }, [pagamentos, inputs]);

  const totalASalvar = useMemo(
    () => Object.keys(inputs).reduce((s, accId) => s + totalCentsOf(inputs, accId, null), 0) / 100,
    [inputs]
  );

  const totalAba = useMemo(
    () => convenioAccounts.reduce((s, acc) => s + totalCentsOf(inputs, acc.id, aba), 0),
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
        <table className="w-full table-fixed text-sm min-w-[760px]">
          <colgroup>
            <col className="w-[22%]" />
            {FONTES.map(f => <col key={f} className="w-[17%]" />)}
            <col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <th className="px-4 py-2 text-left font-semibold">Conta / Convênio</th>
              {FONTES.map(f => (
                <th key={f} className="px-2 py-2 text-right font-semibold">{FONTES_LABEL[f]}</th>
              ))}
              <th className="px-3 py-2 text-right font-semibold bg-slate-100/70">Total</th>
            </tr>
          </thead>
          <tbody>
            {convenioAccounts.map(acc => {
              const conv = convenioPorConta.get(acc.id);
              const totalLinha = totalCentsOf(inputs, acc.id, aba) / 100;
              return (
                <tr key={acc.id} className="border-b border-slate-100 hover:bg-slate-50/50 h-16">
                  <td className="px-4 py-1.5 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate" title={acc.nome}>{acc.nome}</p>
                  </td>
                  {FONTES.map(f => {
                    const proj = conv ? projectedSaldo(conv, f) : null;
                    return (
                      <td key={`${acc.id}-${aba}-${f}`} className="px-2 py-1.5 text-right min-w-0">
                        <MoneyInput
                          value={(inputs[acc.id]?.[aba]?.[f] ?? 0) / 100}
                          onValueChange={(v) => handleInputChange(acc.id, aba, f, Math.round((v || 0) * 100))}
                          disabled={fechado}
                          placeholder="0,00"
                          className="w-full px-1.5 py-1.5 text-[11px] tabular-nums"
                        />
                        {proj != null && (
                          <p
                            className={`text-[10px] mt-0.5 truncate ${proj < 0 ? 'text-red-700 font-semibold' : 'text-slate-400'}`}
                            title={`Saldo: ${formatCurrency(proj)}`}
                          >
                            Saldo: {formatCurrency(proj)}
                          </p>
                        )}
                      </td>
                    );
                  })}
                  <td className={`px-3 py-1.5 text-right font-bold bg-slate-100/50 tabular-nums ${totalLinha > 0 ? 'text-slate-700' : 'text-slate-400'}`}>
                    {formatCurrency(totalLinha)}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-200 bg-slate-100 font-bold">
              <td className="px-4 py-2 text-xs text-slate-800 uppercase tracking-wide">Total da aba</td>
              {FONTES.map(f => {
                const tot = convenioAccounts.reduce((s, acc) => s + (inputs[acc.id]?.[aba]?.[f] ?? 0), 0) / 100;
                return (
                  <td key={`tot-${f}`} className="px-2 py-2 text-right text-xs text-slate-800 tabular-nums">{formatCurrency(tot)}</td>
                );
              })}
              <td className="px-3 py-2 text-right text-xs text-slate-800 bg-slate-200/50 tabular-nums">{formatCurrency(totalAba / 100)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Rodapé: total geral das três abas */}
      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">
          Total a salvar neste BT: <span className="text-slate-800 tabular-nums">{formatCurrency(totalASalvar)}</span>
        </p>
      </div>

      {/* Histórico de pagamentos por fonte (editável) */}
      {pagamentos.length > 0 && (
        <div className="m-4 border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Pagamentos por Fonte Registrados</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm min-w-[640px]">
              <colgroup>
                <col className="w-[34%]" />
                <col className="w-[24%]" />
                <col className="w-[14%]" />
                <col className="w-[16%]" />
                <col className="w-[12%]" />
              </colgroup>
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
                    <td className="px-3 py-2 text-slate-700 truncate" title={convenioAccounts.find(a => a.id === p.account_id)?.nome ?? '—'}>
                      {convenioAccounts.find(a => a.id === p.account_id)?.nome ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-700 truncate">{GRUPOS.find(g => g.field === p.tipo_orcamento)?.label ?? p.tipo_orcamento}</td>
                    <td className="px-3 py-2 font-semibold text-blue-700 truncate">{FONTES_LABEL[p.fonte_orcamentaria as FonteOrcamentaria]}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-700 tabular-nums">{formatCurrency(p.valor)}</td>
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
        </div>
      )}

      {/* Linhas antigas sem fonte: somente leitura */}
      {legado.length > 0 && (
        <div className="mx-4 mb-4 border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Sem fonte (legado) — somente leitura</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm min-w-[520px]">
              <colgroup>
                <col className="w-[40%]" />
                <col className="w-[34%]" />
                <col className="w-[26%]" />
              </colgroup>
              <tbody>
                {legado.map(t => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-700 truncate" title={convenioAccounts.find(a => a.id === t.account_id)?.nome ?? '—'}>
                      {convenioAccounts.find(a => a.id === t.account_id)?.nome ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-500 truncate">{GRUPOS.find(g => g.field === t.tipo_orcamento)?.label ?? t.tipo_orcamento}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-500 tabular-nums">{formatCurrency(t.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
