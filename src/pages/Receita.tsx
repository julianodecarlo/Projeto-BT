import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Layers, FileText, Pencil, X, Check, Handshake, Save, Lock, LockOpen, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import { Card, Button, Input, Field, EmptyState } from '@/components/ui/Field';
import Decimal from 'decimal.js';
import { formatCurrency, toDecimal, toNumber, sumDecimal } from '@/lib/format';
import type { RevenueOwn, Subalinea } from '@/types';
import { BtFechadoGuard, BtFechadoBanner } from '@/components/BtFechadoGuard';
import { MoneyInput } from '@/components/ui/MoneyInput';
import Modal from '@/components/ui/Modal';

export default function Receita() {
  const { currentBt } = useBt();
  const fechado = currentBt?.status === 'fechado';
  const [revenues, setRevenues] = useState<RevenueOwn[]>([]);
  const [subalinhas, setSubalinhas] = useState<Subalinea[]>([]);

  // Subalinea management
  const [showSubForm, setShowSubForm] = useState(false);
  const [newSubCodigo, setNewSubCodigo] = useState('');
  const [newSubDesc, setNewSubDesc] = useState('');
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [editSubCodigo, setEditSubCodigo] = useState('');
  const [editSubDesc, setEditSubDesc] = useState('');

  const fetchAll = useCallback(async () => {
    const { data: subs } = await supabase.from('subalinhas').select('*').order('ordem');
    if (subs) setSubalinhas(subs as Subalinea[]);
    if (currentBt) {
      const { data: revs } = await supabase
        .from('revenue_own')
        .select('*')
        .eq('bt_report_id', currentBt.id)
        .order('ordem', { ascending: true });
      if (revs) setRevenues(revs as RevenueOwn[]);
    }
  }, [currentBt]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const addSubalinea = async () => {
    if (!newSubCodigo.trim() || !newSubDesc.trim()) return;
    const maxOrdem = subalinhas.length > 0 ? Math.max(...subalinhas.map(s => s.ordem)) : 0;
    const { data: sub } = await supabase.from('subalinhas').insert({
      codigo: newSubCodigo.trim(),
      descricao: newSubDesc.trim(),
      ordem: maxOrdem + 1,
      ativo: true,
    }).select().single();

    // Incorpora a nova subalínea com saldo zero nas duas tabelas do BT ativo
    if (currentBt && sub) {
      const nome = `${sub.codigo} - ${sub.descricao}`;
      const rows = [
        { bt_report_id: currentBt.id, subalinea: nome, tipo: 'contabil', saldo_anterior: 0, arrecadacao: 0, saldo_final_contabil: 0, caixa: 0, bancos: 0, saldo_final_financeiro: 0, account_id: null, ordem: 0 },
        { bt_report_id: currentBt.id, subalinea: nome, tipo: 'financeira', saldo_anterior: 0, arrecadacao: 0, saldo_final_contabil: 0, caixa: 0, bancos: 0, saldo_final_financeiro: 0, account_id: null, ordem: 0 },
      ];
      const { data: revs, error } = await supabase.from('revenue_own').insert(rows).select();
      if (!error && revs) setRevenues(prev => [...prev, ...(revs as RevenueOwn[])]);
    }

    setNewSubCodigo(''); setNewSubDesc('');
    setShowSubForm(false);
    const { data: subs } = await supabase.from('subalinhas').select('*').order('ordem');
    if (subs) setSubalinhas(subs as Subalinea[]);
  };

  const startEditSub = (sub: Subalinea) => {
    setEditingSubId(sub.id);
    setEditSubCodigo(sub.codigo);
    setEditSubDesc(sub.descricao);
  };

  const saveEditSub = async () => {
    if (!editingSubId) return;
    await supabase.from('subalinhas').update({
      codigo: editSubCodigo.trim(),
      descricao: editSubDesc.trim(),
    }).eq('id', editingSubId);
    setEditingSubId(null);
    fetchAll();
  };

  const deleteSubalinea = async (id: string) => {
    await supabase.from('subalinhas').delete().eq('id', id);
    setSubalinhas(subalinhas.filter(s => s.id !== id));
  };

  // Edição em células: as alterações ficam pendentes até clicar em "Salvar Lançamentos"
  const [cellEdits, setCellEdits] = useState<Record<string, string>>({});
  const [saldoEdits, setSaldoEdits] = useState<Record<string, string>>({});
  const [saldoUnlock, setSaldoUnlock] = useState(false);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const getCell = (r: RevenueOwn, field: 'arrecadacao' | 'caixa' | 'bancos') =>
    cellEdits[`${r.id}:${field}`] ?? String(r[field] ?? '');
  const setCell = (r: RevenueOwn, field: 'arrecadacao' | 'caixa' | 'bancos', v: string) =>
    setCellEdits(prev => ({ ...prev, [`${r.id}:${field}`]: v }));
  const getSaldoCell = (r: RevenueOwn) => saldoEdits[r.id] ?? String(r.saldo_anterior ?? '');
  const setSaldoCell = (r: RevenueOwn, v: string) =>
    setSaldoEdits(prev => ({ ...prev, [r.id]: v }));

  const effective = (r: RevenueOwn): RevenueOwn => {
    const saldoAnt = toDecimal(getSaldoCell(r) || 0);
    if (r.tipo === 'contabil') {
      const arrec = toDecimal(getCell(r, 'arrecadacao') || 0);
      return { ...r, saldo_anterior: saldoAnt.toNumber(), arrecadacao: arrec.toNumber(), saldo_final_contabil: saldoAnt.plus(arrec).toNumber() };
    }
    const caixa = toDecimal(getCell(r, 'caixa') || 0);
    const bancos = toDecimal(getCell(r, 'bancos') || 0);
    return { ...r, saldo_anterior: saldoAnt.toNumber(), caixa: caixa.toNumber(), bancos: bancos.toNumber(), saldo_final_financeiro: saldoAnt.plus(caixa).plus(bancos).toNumber() };
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3500);
  };

  const saveAll = async () => {
    const ids = new Set<string>([
      ...Object.keys(cellEdits).map(k => k.split(':')[0]),
      ...Object.keys(saldoEdits),
    ]);
    if (ids.size === 0) {
      showToast('Nenhuma alteração pendente para salvar');
      return;
    }
    setSaving(true);
    let ok = true;
    for (const id of ids) {
      const r = revenues.find(x => x.id === id);
      if (!r) continue;
      const eff = effective(r);
      const payload = r.tipo === 'contabil'
        ? { saldo_anterior: eff.saldo_anterior, arrecadacao: eff.arrecadacao, saldo_final_contabil: eff.saldo_final_contabil }
        : { saldo_anterior: eff.saldo_anterior, caixa: eff.caixa, bancos: eff.bancos, saldo_final_financeiro: eff.saldo_final_financeiro };
      const { data, error } = await supabase.from('revenue_own').update(payload).eq('id', id).select().single();
      if (!error && data) setRevenues(prev => prev.map(x => (x.id === id ? (data as RevenueOwn) : x)));
      else ok = false;
    }
    setCellEdits({});
    setSaldoEdits({});
    setSaldoUnlock(false);
    setSaving(false);
    showToast(ok ? 'Lançamentos salvos com sucesso' : 'Erro ao salvar alguns lançamentos. Tente novamente.');
  };

  const deleteRevenue = async (id: string) => {
    await supabase.from('revenue_own').delete().eq('id', id);
    setRevenues(revenues.filter(r => r.id !== id));
  };

  const cellInput = (r: RevenueOwn, field: 'arrecadacao' | 'caixa' | 'bancos') => (
    <MoneyInput
      value={parseFloat(getCell(r, field)) || null}
      onValueChange={(v) => setCell(r, field, v ? String(v) : '')}
      onKeyDown={() => {}}
      className="w-24 px-1 py-1 text-sm"
    />
  );

  const saldoCell = (r: RevenueOwn) =>
    saldoUnlock ? (
      <MoneyInput
        value={parseFloat(getSaldoCell(r)) || null}
        onValueChange={(v) => setSaldoCell(r, v ? String(v) : '')}
        onKeyDown={() => {}}
        className="w-24 px-1 py-1 text-sm"
      />
    ) : (
      formatCurrency(r.saldo_anterior)
    );

  const saldoButtons = (
    <div className="flex items-center gap-2">
      {saldoUnlock ? (
        <Button size="sm" variant="secondary" onClick={() => setSaldoUnlock(false)}>
          <LockOpen className="w-3.5 h-3.5" /> Saldo Anterior liberado para edição
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setShowUnlockConfirm(true)}>
          <Lock className="w-3.5 h-3.5" /> Editar Saldo Anterior
        </Button>
      )}
      <Button size="sm" onClick={saveAll} disabled={saving}>
        <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar Lançamentos'}
      </Button>
    </div>
  );

  if (!currentBt) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Nenhum BT ativo" description="Crie um novo Boletim de Tesouraria para registrar as Receitas Próprias." />
      </div>
    );
  }

  const bySubCodigo = (a: { subalinea: string }, b: { subalinea: string }) =>
    a.subalinea.localeCompare(b.subalinea, undefined, { numeric: true, sensitivity: 'base' });
  const revContabil = revenues.filter(r => r.tipo === 'contabil').map(effective).sort(bySubCodigo);
  const revFinanceira = revenues.filter(r => r.tipo === 'financeira').map(effective).sort(bySubCodigo);

  // Consolidação por subalínea (somente saldos diferentes de zero)
  const parseSubLabel = (label: string) => {
    const idx = label.indexOf(' - ');
    return idx === -1 ? { codigo: label, nome: label } : { codigo: label.slice(0, idx), nome: label.slice(idx + 3) };
  };
  const consolidado: { codigo: string; nome: string; saldoCont: Decimal; saldoFin: Decimal }[] = [];
  const seen = new Set<string>();
  for (const sub of subalinhas) {
    const label = `${sub.codigo} - ${sub.descricao}`;
    seen.add(label);
    const c = revContabil.find(r => r.subalinea === label);
    const f = revFinanceira.find(r => r.subalinea === label);
    consolidado.push({ codigo: sub.codigo, nome: sub.descricao, saldoCont: toDecimal(c?.saldo_final_contabil ?? 0), saldoFin: toDecimal(f?.saldo_final_financeiro ?? 0) });
  }
  for (const label of new Set(revenues.map(r => r.subalinea))) {
    if (seen.has(label)) continue;
    const { codigo, nome } = parseSubLabel(label);
    const c = revContabil.find(r => r.subalinea === label);
    const f = revFinanceira.find(r => r.subalinea === label);
    consolidado.push({ codigo, nome, saldoCont: toDecimal(c?.saldo_final_contabil ?? 0), saldoFin: toDecimal(f?.saldo_final_financeiro ?? 0) });
  }
  const comSaldo = consolidado
    .filter(x => !x.saldoCont.isZero() || !x.saldoFin.isZero())
    .sort((a, b) =>
      `${a.codigo} - ${a.nome}`.localeCompare(`${b.codigo} - ${b.nome}`, undefined, { numeric: true, sensitivity: 'base' })
    );
  const totalContResumo = comSaldo.reduce((acc, x) => acc.plus(x.saldoCont), new Decimal(0)).toNumber();
  const totalFinResumo = comSaldo.reduce((acc, x) => acc.plus(x.saldoFin), new Decimal(0)).toNumber();
  const totalGeralResumo = totalContResumo + totalFinResumo;

  return (
    <>
    {fechado && <div className="px-6 pt-4"><BtFechadoBanner numero={currentBt?.numero ?? ''} /></div>}
    <BtFechadoGuard fechado={fechado}>
    <div className="p-6 space-y-4">
      {/* 1º: RP Financeira - 4 colunas */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-emerald-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-800">Receitas Próprias - Financeira (4 Colunas)</h3>
              <p className="text-xs text-slate-500 mt-0.5">Saldo Anterior · Caixa · Bancos · Saldo Final</p>
            </div>
          </div>
          <div className="flex-shrink-0">{saldoButtons}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Subalínea</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Anterior</th>
                <th className="px-4 py-2 text-right font-semibold">Caixa</th>
                <th className="px-4 py-2 text-right font-semibold">Bancos</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Final</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {revFinanceira.map(r => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50 group">
                  <td className="px-4 py-2.5 text-slate-700">{r.subalinea}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{saldoCell(r)}</td>
                  <td className="px-2 py-1.5 text-right">{cellInput(r, 'caixa')}</td>
                  <td className="px-2 py-1.5 text-right">{cellInput(r, 'bancos')}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-700">{formatCurrency(r.saldo_final_financeiro)}</td>
                  <td className="px-2 py-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => deleteRevenue(r.id)} className="text-slate-400 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {revFinanceira.length === 0 && (
                <tr><td colSpan={6} className="text-center text-slate-400 py-4 text-xs">Nenhuma receita financeira registrada</td></tr>
              )}
              {revFinanceira.length > 0 && (
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                  <td className="px-4 py-2.5 text-slate-800">Total</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{formatCurrency(toNumber(sumDecimal(revFinanceira.map(r => r.saldo_anterior))))}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{formatCurrency(toNumber(sumDecimal(revFinanceira.map(r => r.caixa))))}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{formatCurrency(toNumber(sumDecimal(revFinanceira.map(r => r.bancos))))}</td>
                  <td className="px-4 py-2.5 text-right text-slate-800">{formatCurrency(toNumber(sumDecimal(revFinanceira.map(r => r.saldo_final_financeiro))))}</td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 2º: RP Contábil - 3 colunas */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-800">Receitas Próprias - Contábil (3 Colunas)</h3>
              <p className="text-xs text-slate-500 mt-0.5">Saldo Anterior · Arrecadação · Saldo Final</p>
            </div>
          </div>
          <div className="flex-shrink-0">{saldoButtons}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Subalínea</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Anterior</th>
                <th className="px-4 py-2 text-right font-semibold">Arrecadação</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Final</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {revContabil.map(r => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50 group">
                  <td className="px-4 py-2.5 text-slate-700">{r.subalinea}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{saldoCell(r)}</td>
                  <td className="px-2 py-1.5 text-right">{cellInput(r, 'arrecadacao')}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-700">{formatCurrency(r.saldo_final_contabil)}</td>
                  <td className="px-2 py-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => deleteRevenue(r.id)} className="text-slate-400 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {revContabil.length === 0 && (
                <tr><td colSpan={5} className="text-center text-slate-400 py-4 text-xs">Nenhuma receita contábil registrada</td></tr>
              )}
              {revContabil.length > 0 && (
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                  <td className="px-4 py-2.5 text-slate-800">Total</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{formatCurrency(toNumber(sumDecimal(revContabil.map(r => r.saldo_anterior))))}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-700">{formatCurrency(toNumber(sumDecimal(revContabil.map(r => r.arrecadacao))))}</td>
                  <td className="px-4 py-2.5 text-right text-slate-800">{formatCurrency(toNumber(sumDecimal(revContabil.map(r => r.saldo_final_contabil))))}</td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 3º: Resumo por Subalínea */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-800">Resumo por Subalínea</h3>
          <p className="text-xs text-slate-500 mt-0.5">Consolidação de todas as subalíneas com saldo diferente de zero</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Código</th>
                <th className="px-4 py-2 text-left font-semibold">Subalínea</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Contábil</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Financeiro</th>
                <th className="px-4 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {comSaldo.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-slate-400 py-4 text-xs">Nenhuma subalínea com saldo</td></tr>
              ) : comSaldo.map(x => (
                <tr key={`${x.codigo}-${x.nome}`} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-600">{x.codigo}</td>
                  <td className="px-4 py-2.5 text-slate-700">{x.nome}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${x.saldoCont.isNegative() ? 'text-red-600' : 'text-blue-700'}`}>
                    {formatCurrency(toNumber(x.saldoCont))}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${x.saldoFin.isNegative() ? 'text-red-600' : 'text-emerald-700'}`}>
                    {formatCurrency(toNumber(x.saldoFin))}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-bold ${x.saldoCont.plus(x.saldoFin).isNegative() ? 'text-red-600' : 'text-slate-800'}`}>
                    {formatCurrency(toNumber(x.saldoCont.plus(x.saldoFin)))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-100 font-bold">
                <td className="px-4 py-2.5 text-slate-800" colSpan={2}>Total</td>
                <td className="px-4 py-2.5 text-right text-slate-800">{formatCurrency(totalContResumo)}</td>
                <td className="px-4 py-2.5 text-right text-slate-800">{formatCurrency(totalFinResumo)}</td>
                <td className="px-4 py-2.5 text-right text-slate-800">{formatCurrency(totalGeralResumo)}</td>
              </tr>
              <tr className="bg-slate-800 text-white">
                <td className="px-4 py-3 font-bold" colSpan={3}>Saldo Total Geral</td>
                <td className="px-4 py-3 text-right text-base font-bold" colSpan={2}>{formatCurrency(totalGeralResumo)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* 4º: Subalíneas de Receita Própria */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-800">Subalíneas de Receita Própria</h3>
              <p className="text-xs text-slate-500 mt-0.5">Lista oficial usada nas tabelas de Receita Própria</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowSubForm(!showSubForm)}>
            <Plus className="w-3.5 h-3.5" /> Nova Subalínea
          </Button>
        </div>
        {showSubForm && (
          <div className="p-3 bg-blue-50/30 border-b border-slate-100 grid grid-cols-2 gap-2">
            <Field label="Código">
              <Input value={newSubCodigo} onChange={(e) => setNewSubCodigo(e.target.value)} placeholder="Ex: 0121.03.00" autoFocus />
            </Field>
            <Field label="Descrição">
              <Input value={newSubDesc} onChange={(e) => setNewSubDesc(e.target.value)} placeholder="Ex: Emendas Estaduais" />
            </Field>
            <div className="col-span-2 flex justify-end gap-2 mt-1">
              <Button size="sm" variant="secondary" onClick={() => setShowSubForm(false)}>Cancelar</Button>
              <Button size="sm" onClick={addSubalinea}>Adicionar</Button>
            </div>
          </div>
        )}
        <div className="p-3 max-h-48 overflow-y-auto">
          <div className="space-y-1">
            {subalinhas.map(sub => (
              <div key={sub.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-50 group">
                {editingSubId === sub.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input value={editSubCodigo} onChange={(e) => setEditSubCodigo(e.target.value)} className="w-32 py-1 text-xs" />
                    <Input value={editSubDesc} onChange={(e) => setEditSubDesc(e.target.value)} className="flex-1 py-1 text-xs" />
                    <button onClick={saveEditSub} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingSubId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold text-slate-600">{sub.codigo}</span>
                      <span className="text-xs text-slate-500">- {sub.descricao}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => startEditSub(sub)} className="p-1 text-slate-400 hover:text-blue-600">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteSubalinea(sub.id)} className="p-1 text-slate-400 hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
        <Handshake className="w-3.5 h-3.5" />
        A gestão dos Convênios (fontes 5/45/4/44) está na aba "Controle de Convênios" no menu.
      </div>
    </div>
    </BtFechadoGuard>
    <Modal open={showUnlockConfirm} onClose={() => setShowUnlockConfirm(false)} title="Editar Saldo Anterior">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-slate-600 leading-relaxed">
          Atenção: A alteração manual do saldo anterior afeta a integridade dos cálculos do BT. Deseja prosseguir?
        </p>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={() => setShowUnlockConfirm(false)}>Cancelar</Button>
        <Button
          onClick={() => { setShowUnlockConfirm(false); setSaldoUnlock(true); }}
          className="!bg-amber-600 hover:!bg-amber-700"
        >
          <LockOpen className="w-4 h-4" /> Sim, liberar edição
        </Button>
      </div>
    </Modal>
    {toast && (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white text-sm font-medium rounded-lg shadow-xl">
          <Check className="w-4 h-4 text-emerald-400" />
          {toast}
        </div>
      </div>
    )}
    </>
  );
}
