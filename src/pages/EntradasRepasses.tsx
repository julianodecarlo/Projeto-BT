import { useEffect, useMemo, useRef, useState } from 'react';
import { Save, AlertTriangle, Check, FileText } from 'lucide-react';
import { useBt } from '@/context/BtContext';
import { Card, Button, EmptyState } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { BtFechadoBanner } from '@/components/BtFechadoGuard';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetchAll';
import { listTransactions } from '@/services/transactionService';
import { listBts } from '@/services/btService';
import {
  calcularSistema,
  comparar,
  descricaoPeriodo,
  type EntradasRepassesRow,
  type SavedEntradasRepasses,
} from '@/lib/entradasRepasses';
import { formatCurrency } from '@/lib/format';
import { setUnsavedGuard, setUnsavedSaver, subscribeUnsavedGuard, hasUnsavedGuard } from '@/lib/unsavedGuard';

const GUARD_ORIGIN = 'entradas_repasses';

type FormState = {
  inf_total_pagamentos: number;
  inf_rp_tesouro: number;
  inf_rp_convenio: number;
  inf_rp_receita: number;
  inf_dc_tesouro: number;
  inf_dc_convenio: number;
  inf_dc_receita: number;
  inf_anulacoes: number;
  contabeis_novo_vigente: number;
  contabeis_novo_restos: number;
  contabeis_novo_diversos: number;
  ajuste_total_pagamentos: number;
  ajuste_anulacoes: number;
  observacao: string;
};

const emptyForm = (): FormState => ({
  inf_total_pagamentos: 0,
  inf_rp_tesouro: 0, inf_rp_convenio: 0, inf_rp_receita: 0,
  inf_dc_tesouro: 0, inf_dc_convenio: 0, inf_dc_receita: 0,
  inf_anulacoes: 0,
  contabeis_novo_vigente: 0, contabeis_novo_restos: 0, contabeis_novo_diversos: 0,
  ajuste_total_pagamentos: 0, ajuste_anulacoes: 0,
  observacao: '',
});

function rowToForm(row: SavedEntradasRepasses): FormState {
  return {
    inf_total_pagamentos: row.inf_total_pagamentos ?? 0,
    inf_rp_tesouro: row.inf_rp_tesouro ?? 0,
    inf_rp_convenio: row.inf_rp_convenio ?? 0,
    inf_rp_receita: row.inf_rp_receita ?? 0,
    inf_dc_tesouro: row.inf_dc_tesouro ?? 0,
    inf_dc_convenio: row.inf_dc_convenio ?? 0,
    inf_dc_receita: row.inf_dc_receita ?? 0,
    inf_anulacoes: row.inf_anulacoes ?? 0,
    contabeis_novo_vigente: row.contabeis_novo_vigente ?? 0,
    contabeis_novo_restos: row.contabeis_novo_restos ?? 0,
    contabeis_novo_diversos: row.contabeis_novo_diversos ?? 0,
    ajuste_total_pagamentos: row.ajuste_total_pagamentos ?? 0,
    ajuste_anulacoes: row.ajuste_anulacoes ?? 0,
    observacao: row.observacao ?? '',
  };
}

function formToRow(f: FormState): EntradasRepassesRow {
  return { ...f, observacao: f.observacao.trim() || null };
}

function SituacaoPill({ ok, diferenca }: { ok: boolean; diferenca: number }) {
  if (ok) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">OK</span>;
  }
  const sinal = diferenca > 0 ? '+' : '−';
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700" title="Sistema − Informado">
      {sinal}{formatCurrency(Math.abs(diferenca))}
    </span>
  );
}

export default function EntradasRepasses() {
  const { currentBt, accounts } = useBt();
  const fechado = currentBt?.status === 'fechado';
  const [form, setForm] = useState<FormState>(emptyForm);
  const [savedSnapshot, setSavedSnapshot] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const formRef = useRef(form);
  formRef.current = form;
  const currentBtId = currentBt?.id ?? null;
  const currentBtRef = useRef(currentBt);
  currentBtRef.current = currentBt;

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(savedSnapshot), [form, savedSnapshot]);
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  // Dados para o cálculo: BTs do mês, TODAS as transações do mês e contas.
  const [allBts, setAllBts] = useState<Awaited<ReturnType<typeof listBts>>>([]);
  const [transacoesMes, setTransacoesMes] = useState<Awaited<ReturnType<typeof listTransactions>>>([]);
  const [btIdsPeriodo, setBtIdsPeriodo] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const bts = await listBts();
      setAllBts(bts);
      if (!currentBt) {
        setBtIdsPeriodo([]);
        setTransacoesMes([]);
        return;
      }
      const { btIds } = descricaoPeriodo(currentBt, bts);
      setBtIdsPeriodo(btIds);
      // Transações de todos os BTs do período (acumulado do mês).
      const todas: Awaited<ReturnType<typeof listTransactions>> = [];
      for (const btId of btIds) {
        todas.push(...await listTransactions(btId));
      }
      setTransacoesMes(todas);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBtId]);

  // Carrega a linha salva do BT atual + linhas contábeis dos BTs anteriores do mês.
  const [linhasSalvas, setLinhasSalvas] = useState<SavedEntradasRepasses[]>([]);
  useEffect(() => {
    (async () => {
      if (!currentBt) { setLinhasSalvas([]); return; }
      const rows = await fetchAll<SavedEntradasRepasses>((from, to) =>
        supabase.from('bt_entradas_repasses').select('*').in('bt_report_id', btIdsPeriodo.length > 0 ? btIdsPeriodo : [currentBt.id]).range(from, to)
      );
      setLinhasSalvas(rows);
      const minha = rows.find(r => r.bt_report_id === currentBt.id);
      const f = minha ? rowToForm(minha) : emptyForm();
      setSavedSnapshot(f);
      if (!isDirtyRef.current) setForm(f);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBtId, btIdsPeriodo.join(',')]);

  const sistema = useMemo(() => {
    if (!currentBt) return null;
    return calcularSistema(currentBt, allBts, transacoesMes, accounts, linhasSalvas, btIdsPeriodo);
  }, [currentBt, allBts, transacoesMes, accounts, linhasSalvas, btIdsPeriodo]);

  const periodo = useMemo(
    () => (currentBt ? descricaoPeriodo(currentBt, allBts) : null),
    [currentBt, allBts]
  );

  // Guard + saver
  useEffect(() => { setUnsavedGuard(GUARD_ORIGIN, isDirty); }, [isDirty]);
  useEffect(() => () => setUnsavedGuard(GUARD_ORIGIN, false), []);
  const handleSaveRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() =>
    setUnsavedSaver(GUARD_ORIGIN, async () => {
      await handleSaveRef.current();
      return !hasUnsavedGuard();
    }),
  []);
  // Descarte explícito (barreira global): volta ao snapshot gravado.
  const wasDirtyGlobal = useRef(false);
  useEffect(() =>
    subscribeUnsavedGuard(() => {
      const dirtyNow = hasUnsavedGuard();
      if (wasDirtyGlobal.current && !dirtyNow && !isDirtyRef.current) {
        setForm(savedSnapshot);
      }
      wasDirtyGlobal.current = dirtyNow;
    }),
  [savedSnapshot]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSave = async (): Promise<boolean> => {
    if (!currentBt) return false;
    setSaving(true);
    setError(null);
    const row = formToRow(formRef.current);
    const { data, error: upErr } = await supabase
      .from('bt_entradas_repasses')
      .upsert({ bt_report_id: currentBt.id, ...row, updated_at: new Date().toISOString() }, { onConflict: 'bt_report_id' })
      .select('bt_report_id');
    if (upErr || !data || data.length === 0) {
      setError('Não foi possível salvar a conferência. Verifique e tente novamente.');
      setSaving(false);
      return false;
    }
    setSavedSnapshot(formRef.current);
    setSaving(false);
    setFlash('Conferência salva com sucesso!');
    setTimeout(() => setFlash(null), 3000);
    return true;
  };
  handleSaveRef.current = async () => { await handleSave(); };

  if (!currentBt) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Nenhum BT ativo" description="Crie um novo Boletim de Tesouraria para lançar a conferência de entradas e repasses." />
      </div>
    );
  }

  const mantaLiquidoInformado = form.inf_total_pagamentos - form.inf_anulacoes;

  const linhasConferencia: { key: string; item: string; sistema: number; informado: number; ok: boolean; diferenca: number }[] = [];
  const addLinha = (key: string, item: string, s: number, i: number) => {
    const c = comparar(s, i);
    linhasConferencia.push({ key, item, sistema: s, informado: i, ok: c.ok, diferenca: c.diferenca });
  };
  if (sistema) {
    addLinha('manta', 'Total de pagamentos (Manta Geral)', sistema.mantaGeral, form.inf_total_pagamentos);
    addLinha('rp-tes', 'Restos a Pagar — Tesouro', sistema.restosPorOrigem.tesouro, form.inf_rp_tesouro);
    addLinha('rp-conv', 'Restos a Pagar — Convênio', sistema.restosPorOrigem.convenio, form.inf_rp_convenio);
    addLinha('rp-rec', 'Restos a Pagar — Receita própria', sistema.restosPorOrigem.receita, form.inf_rp_receita);
    addLinha('dc-tes', 'Diversos Credores — Tesouro', sistema.diversosPorOrigem.tesouro, form.inf_dc_tesouro);
    addLinha('dc-conv', 'Diversos Credores — Convênio', sistema.diversosPorOrigem.convenio, form.inf_dc_convenio);
    addLinha('dc-rec', 'Diversos Credores — Receita própria', sistema.diversosPorOrigem.receita, form.inf_dc_receita);
    addLinha('anul', 'Anulações', sistema.anulacoes, form.inf_anulacoes);
    addLinha('liquido', 'Manta Líquido', sistema.mantaLiquido, mantaLiquidoInformado);
  }

  const temAvisos = (sistema?.avisoLegadoConvenio || (sistema?.contasNaoClassificadas.length ?? 0) > 0);

  const moneyCell = (key: keyof FormState) => (
    <MoneyInput
      value={form[key] as number}
      onValueChange={(v) => set(key, v)}
      disabled={fechado}
      className="w-full px-1.5 py-1 text-xs tabular-nums"
    />
  );

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      <BtFechadoBanner numero={currentBt.numero} />

      {error && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 font-medium">{error}</div>
      )}
      {flash && (
        <div className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 font-medium flex items-center gap-2">
          <Check className="w-4 h-4" /> {flash}
        </div>
      )}

      {periodo && (
        <p className="text-xs text-slate-500">
          Período considerado: {periodo.primeiroNumero ? `BTs ${periodo.primeiroNumero} a ${periodo.ultimoNumero}` : currentBt.numero}
          {' — '}{periodo.mesAno} (valores acumulados até este BT).
        </p>
      )}

      {/* Card 1: Conferência do mês */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Conferência do mês (acumulado até este BT)</h3>
            <p className="text-xs text-slate-500 mt-0.5">Compara o Sistema (BT) com o Informado pelo orçamentário/financeiro.</p>
          </div>
          <Button onClick={() => handleSave()} disabled={fechado || saving}>
            <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm min-w-[720px]">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[22%]" />
              <col className="w-[32%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <th className="px-3 py-2 text-left font-semibold">Item</th>
                <th className="px-3 py-2 text-right font-semibold">Sistema (BT)</th>
                <th className="px-3 py-2 text-right font-semibold">Informado</th>
                <th className="px-3 py-2 text-center font-semibold">Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhasConferencia.map(l => (
                <tr key={l.key} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-3 py-1.5 text-slate-700">{l.item}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-slate-700 tabular-nums">{formatCurrency(l.sistema)}</td>
                  <td className="px-3 py-1.5">
                    {l.key === 'liquido' ? (
                      <p className="text-right text-xs text-slate-500 tabular-nums py-1.5">{formatCurrency(l.informado)} <span className="text-[10px]">(calculado)</span></p>
                    ) : (
                      moneyCell(l.key === 'manta' ? 'inf_total_pagamentos'
                        : l.key === 'rp-tes' ? 'inf_rp_tesouro'
                        : l.key === 'rp-conv' ? 'inf_rp_convenio'
                        : l.key === 'rp-rec' ? 'inf_rp_receita'
                        : l.key === 'dc-tes' ? 'inf_dc_tesouro'
                        : l.key === 'dc-conv' ? 'inf_dc_convenio'
                        : l.key === 'dc-rec' ? 'inf_dc_receita'
                        : 'inf_anulacoes')
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center"><SituacaoPill ok={l.ok} diferenca={l.diferenca} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Ajustes + observação */}
        <div className="px-4 py-3 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Ajuste explicado — Total de pagamentos</label>
            <div className="mt-1">{moneyCell('ajuste_total_pagamentos')}</div>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Ajuste explicado — Anulações</label>
            <div className="mt-1">{moneyCell('ajuste_anulacoes')}</div>
          </div>
          <div className="md:col-span-2">
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Observação</label>
            <textarea
              value={form.observacao}
              onChange={(e) => set('observacao', e.target.value)}
              disabled={fechado}
              rows={2}
              className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors disabled:bg-slate-100"
              placeholder="Explique os ajustes, se houver."
            />
          </div>
          {sistema && (
            <p className="md:col-span-2 text-[11px] text-slate-500">
              Informativo: das anulações do mês, <span className="font-semibold text-slate-700">{formatCurrency(sistema.anulacoesCompetenciaAnterior)}</span> referem-se a competência anterior.
            </p>
          )}
        </div>
      </Card>

      {/* Card 2: Pagamentos contábeis */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-800">Pagamentos contábeis (sem movimento bancário)</h3>
          <p className="text-xs text-slate-500 mt-0.5">Anterior = soma dos "novo" dos BTs anteriores do mês. Os contábeis entram apenas no Total de pagamentos (Manta Geral).</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm min-w-[640px]">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[22%]" />
              <col className="w-[22%]" />
              <col className="w-[22%]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <th className="px-3 py-2 text-left font-semibold">Categoria</th>
                <th className="px-3 py-2 text-right font-semibold">Anterior</th>
                <th className="px-3 py-2 text-right font-semibold">Novo (neste BT)</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {sistema && ([
                { key: 'vigente' as const, label: 'Orçamento Vigente', novoKey: 'contabeis_novo_vigente' as const },
                { key: 'restos_pagar' as const, label: 'Restos a Pagar', novoKey: 'contabeis_novo_restos' as const },
                { key: 'diversos_credores' as const, label: 'Diversos Credores', novoKey: 'contabeis_novo_diversos' as const },
              ]).map(cat => (
                <tr key={cat.key} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-3 py-1.5 text-slate-700">{cat.label}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500 tabular-nums">{formatCurrency(sistema.contabeisAnterior[cat.key])}</td>
                  <td className="px-3 py-1.5">{moneyCell(cat.novoKey)}</td>
                  <td className="px-3 py-1.5 text-right font-bold text-slate-700 tabular-nums bg-slate-50">{formatCurrency(sistema.contabeisTotal[cat.key])}</td>
                </tr>
              ))}
              {sistema && (
                <tr className="border-t-2 border-slate-200 bg-slate-100 font-bold">
                  <td className="px-3 py-2 text-xs text-slate-800 uppercase tracking-wide">Total geral</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-800 tabular-nums">
                    {formatCurrency(sistema.contabeisAnterior.vigente + sistema.contabeisAnterior.restos_pagar + sistema.contabeisAnterior.diversos_credores)}
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right text-xs text-slate-800 tabular-nums bg-slate-200/50">
                    {formatCurrency(sistema.contabeisTotal.vigente + sistema.contabeisTotal.restos_pagar + sistema.contabeisTotal.diversos_credores)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Card 3: Avisos */}
      {temAvisos && sistema && (
        <Card className="overflow-hidden border-amber-200">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold text-amber-800">Avisos</h3>
          </div>
          <ul className="p-4 space-y-2 text-sm text-amber-800 list-disc list-inside">
            {sistema.avisoLegadoConvenio && (
              <li>Há pagamentos em contas de convênio sem fonte orçamentária (legado) no período — eles contam como "Convênio" no Total de pagamentos.</li>
            )}
            {sistema.contasNaoClassificadas.length > 0 && (
              <li>Contas não classificadas por origem: {sistema.contasNaoClassificadas.join(', ')}.</li>
            )}
          </ul>
        </Card>
      )}
    </div>
  );
}
