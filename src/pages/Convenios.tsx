import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Handshake, FileText, Layers, Pencil, X, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import { Card, Button, Input, Field, Select, Badge, EmptyState } from '@/components/ui/Field';
import Decimal from 'decimal.js';
import { formatCurrency, toDecimal, toNumber, sumDecimal } from '@/lib/format';
import type { Convenio, ConvenioSource, RevenueOwn, RevenueType, Subalinea } from '@/types';

export default function Convenios() {
  const { currentBt, accounts } = useBt();
  const [convenios, setConvenios] = useState<Convenio[]>([]);
  const [sources, setSources] = useState<ConvenioSource[]>([]);
  const [revenues, setRevenues] = useState<RevenueOwn[]>([]);
  const [subalinhas, setSubalinhas] = useState<Subalinea[]>([]);

  // Convenio form
  const [showConvForm, setShowConvForm] = useState(false);
  const [convNome, setConvNome] = useState('');
  const [convAccountId, setConvAccountId] = useState('');

  // Revenue form
  const [showRevForm, setShowRevForm] = useState(false);
  const [revSubalinea, setRevSubalinea] = useState('');
  const [revTipo, setRevTipo] = useState<RevenueType>('contabil');
  const [revSaldoAnt, setRevSaldoAnt] = useState('');
  const [revArrecadacao, setRevArrecadacao] = useState('');
  const [revCaixa, setRevCaixa] = useState('');
  const [revBancos, setRevBancos] = useState('');
  const [revAccountId, setRevAccountId] = useState('');

  // Subalinea management
  const [showSubForm, setShowSubForm] = useState(false);
  const [newSubCodigo, setNewSubCodigo] = useState('');
  const [newSubDesc, setNewSubDesc] = useState('');
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [editSubCodigo, setEditSubCodigo] = useState('');
  const [editSubDesc, setEditSubDesc] = useState('');

  const fetchAll = useCallback(async () => {
    const { data: convs } = await supabase.from('convenios').select('*').order('nome');
    if (convs) setConvenios(convs as Convenio[]);
    const { data: srcs } = await supabase.from('convenio_sources').select('*');
    if (srcs) setSources(srcs as ConvenioSource[]);
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

  useEffect(() => {
    if (subalinhas.length > 0 && !revSubalinea) {
      const first = subalinhas[0];
      setRevSubalinea(`${first.codigo} - ${first.descricao}`);
    }
  }, [subalinhas, revSubalinea]);

  useEffect(() => {
    if (accounts.length > 0) {
      if (!convAccountId) setConvAccountId(accounts.find(a => a.categoria === 'convenio')?.id || accounts[0].id);
      if (!revAccountId) setRevAccountId(accounts.find(a => a.categoria === 'receita')?.id || accounts[0].id);
    }
  }, [accounts, convAccountId, revAccountId]);

  // Convenio handlers
  const addConvenio = async () => {
    if (!convNome.trim()) return;
    const { data: conv, error } = await supabase
      .from('convenios')
      .insert({ nome: convNome.trim(), account_id: convAccountId || null })
      .select()
      .single();
    if (!error && conv) {
      const defaultSources = [
        { convenio_id: conv.id, tipo: 'convenio', codigo_vigente: '5', codigo_superavit: '45' },
        { convenio_id: conv.id, tipo: 'receita', codigo_vigente: '4', codigo_superavit: '44' },
      ];
      await supabase.from('convenio_sources').insert(defaultSources);
      setConvenios([...convenios, conv as Convenio]);
      setConvNome('');
      setShowConvForm(false);
      fetchAll();
    }
  };

  const deleteConvenio = async (id: string) => {
    await supabase.from('convenios').delete().eq('id', id);
    setConvenios(convenios.filter(c => c.id !== id));
    setSources(sources.filter(s => s.convenio_id !== id));
  };

  // Subalínea handlers
  const addSubalinea = async () => {
    if (!newSubCodigo.trim() || !newSubDesc.trim()) return;
    const maxOrdem = subalinhas.length > 0 ? Math.max(...subalinhas.map(s => s.ordem)) : 0;
    await supabase.from('subalinhas').insert({
      codigo: newSubCodigo.trim(),
      descricao: newSubDesc.trim(),
      ordem: maxOrdem + 1,
      ativo: true,
    });
    setNewSubCodigo('');
    setNewSubDesc('');
    setShowSubForm(false);
    fetchAll();
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

  // Revenue handlers
  const addRevenue = async () => {
    if (!currentBt || !revSubalinea || !revSaldoAnt || !revArrecadacao) return;
    const saldoAnt = toDecimal(revSaldoAnt);
    const arrec = toDecimal(revArrecadacao);
    const saldoFinCont = saldoAnt.plus(arrec);
    const caixa = revTipo === 'financeira' ? toDecimal(revCaixa || 0) : new Decimal(0);
    const bancos = revTipo === 'financeira' ? toDecimal(revBancos || 0) : new Decimal(0);
    const saldoFinFisc = revTipo === 'financeira' ? caixa.plus(bancos) : new Decimal(0);
    const maxOrdem = revenues.length > 0 ? Math.max(...revenues.map(r => r.ordem)) : 0;

    const { data, error } = await supabase
      .from('revenue_own')
      .insert({
        bt_report_id: currentBt.id,
        subalinea: revSubalinea,
        tipo: revTipo,
        saldo_anterior: saldoAnt.toNumber(),
        arrecadacao: arrec.toNumber(),
        saldo_final_contabil: saldoFinCont.toNumber(),
        caixa: caixa.toNumber(),
        bancos: bancos.toNumber(),
        saldo_final_financeiro: saldoFinFisc.toNumber(),
        account_id: revTipo === 'financeira' ? (revAccountId || null) : null,
        ordem: maxOrdem + 1,
      })
      .select()
      .single();

    if (!error && data) {
      setRevenues([...revenues, data as RevenueOwn]);
      setRevSaldoAnt(''); setRevArrecadacao(''); setRevCaixa(''); setRevBancos('');
      setShowRevForm(false);
    }
  };

  const deleteRevenue = async (id: string) => {
    await supabase.from('revenue_own').delete().eq('id', id);
    setRevenues(revenues.filter(r => r.id !== id));
  };

  if (!currentBt) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Nenhum BT ativo" description="Crie um novo Boletim de Tesouraria para gerenciar convênios e receitas." />
      </div>
    );
  }

  const revContabil = revenues.filter(r => r.tipo === 'contabil');
  const revFinanceira = revenues.filter(r => r.tipo === 'financeira');
  const totalArrecadacao = toNumber(sumDecimal(revContabil.map(r => r.arrecadacao)));
  const totalSaldoFinalCont = toNumber(sumDecimal(revContabil.map(r => r.saldo_final_contabil)));
  const totalCaixa = toNumber(sumDecimal(revFinanceira.map(r => r.caixa)));
  const totalBancos = toNumber(sumDecimal(revFinanceira.map(r => r.bancos)));
  const totalSaldoFin = toNumber(sumDecimal(revFinanceira.map(r => r.saldo_final_financeiro)));

  return (
    <div className="p-6 space-y-4">
      {/* Subalíneas management */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-800">Subalíneas de Receita Própria</h3>
              <p className="text-xs text-slate-500 mt-0.5">Lista oficial de subalíneas para uso nas tabelas de receita</p>
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

      {/* Convenios section */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Handshake className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-800">Convênios</h3>
              <p className="text-xs text-slate-500 mt-0.5">Agrupamento por fonte (5/45 Convênio, 4/44 Receita)</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowConvForm(!showConvForm)}>
            <Plus className="w-3.5 h-3.5" /> Novo Convênio
          </Button>
        </div>
        {showConvForm && (
          <div className="p-3 bg-blue-50/30 border-b border-slate-100 grid grid-cols-2 gap-2">
            <Field label="Nome do Convênio">
              <Input value={convNome} onChange={(e) => setConvNome(e.target.value)} placeholder="Ex: FUNDUNESP" autoFocus />
            </Field>
            <Field label="Conta Vinculada">
              <Select value={convAccountId} onChange={(e) => setConvAccountId(e.target.value)}>
                {accounts.filter(a => a.ativo).map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </Select>
            </Field>
            <div className="col-span-2 flex justify-end gap-2 mt-1">
              <Button size="sm" variant="secondary" onClick={() => setShowConvForm(false)}>Cancelar</Button>
              <Button size="sm" onClick={addConvenio}>Adicionar</Button>
            </div>
          </div>
        )}
        <div className="p-4">
          {convenios.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">Nenhum convênio cadastrado</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {convenios.map(conv => {
                const convSources = sources.filter(s => s.convenio_id === conv.id);
                const linkedAccount = accounts.find(a => a.id === conv.account_id);
                return (
                  <div key={conv.id} className="border border-slate-200 rounded-lg p-3 group hover:shadow-sm transition-shadow">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-bold text-slate-800">{conv.nome}</p>
                        {linkedAccount && <p className="text-xs text-slate-400 mt-0.5">{linkedAccount.nome}</p>}
                      </div>
                      <button onClick={() => deleteConvenio(conv.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex gap-2">
                      {convSources.map(src => (
                        <Badge key={src.id} color={src.tipo === 'convenio' ? 'blue' : 'green'}>
                          {src.tipo === 'convenio' ? 'Convênio' : 'Receita'}: {src.codigo_vigente}/{src.codigo_superavit}
                        </Badge>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* RP Contábil - 3 columns */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-800">Receitas Próprias - Contábil (3 Colunas)</h3>
              <p className="text-xs text-slate-500 mt-0.5">Saldo Anterior · Arrecadação · Saldo Final</p>
            </div>
          </div>
          <Button size="sm" onClick={() => { setRevTipo('contabil'); setShowRevForm(!showRevForm); }}>
            <Plus className="w-3.5 h-3.5" /> Nova Linha
          </Button>
        </div>
        {showRevForm && revTipo === 'contabil' && (
          <div className="p-3 bg-blue-50/30 border-b border-slate-100 grid grid-cols-3 gap-2">
            <Field label="Subalínea" className="col-span-3">
              <Select value={revSubalinea} onChange={(e) => setRevSubalinea(e.target.value)}>
                {subalinhas.map(s => (
                  <option key={s.id} value={`${s.codigo} - ${s.descricao}`}>{s.codigo} - {s.descricao}</option>
                ))}
              </Select>
            </Field>
            <Field label="Saldo Anterior (R$)">
              <Input type="number" step="0.01" value={revSaldoAnt} onChange={(e) => setRevSaldoAnt(e.target.value)} placeholder="0,00" />
            </Field>
            <Field label="Arrecadação (R$)">
              <Input type="number" step="0.01" value={revArrecadacao} onChange={(e) => setRevArrecadacao(e.target.value)} placeholder="0,00" />
            </Field>
            <div className="flex items-end">
              <div className="text-sm text-slate-600 pb-2">
                Saldo Final: <span className="font-bold">{formatCurrency(toNumber(toDecimal(revSaldoAnt || 0).plus(toDecimal(revArrecadacao || 0))))}</span>
              </div>
            </div>
            <div className="col-span-3 flex justify-end gap-2 mt-1">
              <Button size="sm" variant="secondary" onClick={() => setShowRevForm(false)}>Cancelar</Button>
              <Button size="sm" onClick={addRevenue}>Adicionar</Button>
            </div>
          </div>
        )}
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
                  <td className="px-4 py-2.5 text-right text-slate-600">{formatCurrency(r.saldo_anterior)}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-600 font-semibold">{formatCurrency(r.arrecadacao)}</td>
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
                  <td className="px-4 py-2.5 text-right text-emerald-700">{formatCurrency(totalArrecadacao)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-800">{formatCurrency(totalSaldoFinalCont)}</td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* RP Financeira - 4 columns */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-emerald-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-800">Receitas Próprias - Financeira (4 Colunas)</h3>
              <p className="text-xs text-slate-500 mt-0.5">Saldo Anterior · Caixa · Bancos · Saldo Final</p>
            </div>
          </div>
          <Button size="sm" onClick={() => { setRevTipo('financeira'); setShowRevForm(!showRevForm); }}>
            <Plus className="w-3.5 h-3.5" /> Nova Linha
          </Button>
        </div>
        {showRevForm && revTipo === 'financeira' && (
          <div className="p-3 bg-emerald-50/30 border-b border-slate-100 grid grid-cols-4 gap-2">
            <Field label="Subalínea" className="col-span-4">
              <Select value={revSubalinea} onChange={(e) => setRevSubalinea(e.target.value)}>
                {subalinhas.map(s => (
                  <option key={s.id} value={`${s.codigo} - ${s.descricao}`}>{s.codigo} - {s.descricao}</option>
                ))}
              </Select>
            </Field>
            <Field label="Saldo Anterior (R$)">
              <Input type="number" step="0.01" value={revSaldoAnt} onChange={(e) => setRevSaldoAnt(e.target.value)} placeholder="0,00" />
            </Field>
            <Field label="Caixa (R$)">
              <Input type="number" step="0.01" value={revCaixa} onChange={(e) => setRevCaixa(e.target.value)} placeholder="0,00" />
            </Field>
            <Field label="Bancos (R$)">
              <Input type="number" step="0.01" value={revBancos} onChange={(e) => setRevBancos(e.target.value)} placeholder="0,00" />
            </Field>
            <Field label="Conta">
              <Select value={revAccountId} onChange={(e) => setRevAccountId(e.target.value)}>
                {accounts.filter(a => a.ativo).map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </Select>
            </Field>
            <div className="col-span-4 flex justify-end gap-2 mt-1">
              <Button size="sm" variant="secondary" onClick={() => setShowRevForm(false)}>Cancelar</Button>
              <Button size="sm" onClick={addRevenue}>Adicionar</Button>
            </div>
          </div>
        )}
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
                  <td className="px-4 py-2.5 text-right text-slate-600">{formatCurrency(r.saldo_anterior)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{formatCurrency(r.caixa)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{formatCurrency(r.bancos)}</td>
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
                  <td className="px-4 py-2.5 text-right text-slate-700">{formatCurrency(totalCaixa)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{formatCurrency(totalBancos)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-800">{formatCurrency(totalSaldoFin)}</td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
