import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Handshake, FileText, Pencil, X, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import { Card, Button, Input, Field, Select, EmptyState, Badge } from '@/components/ui/Field';
import { formatCurrency, toDecimal } from '@/lib/format';
import type { Convenio } from '@/types';
import { BtFechadoGuard, BtFechadoBanner } from '@/components/BtFechadoGuard';

const FONTES = [
  { key: 'fonte_5' as const, label: 'Convênio (Fonte 5)' },
  { key: 'fonte_45' as const, label: 'Convênio Superávit (Fonte 45)' },
  { key: 'fonte_4' as const, label: 'Contrapartida (Fonte 4)' },
  { key: 'fonte_44' as const, label: 'Contrapartida Superávit (Fonte 44)' },
];

type FonteKey = (typeof FONTES)[number]['key'];

export default function Convenios() {
  const { currentBt, accounts } = useBt();
  const fechado = currentBt?.status === 'fechado';
  const [convenios, setConvenios] = useState<Convenio[]>([]);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Convenio | null>(null);
  const [nome, setNome] = useState('');
  const [fontes, setFontes] = useState<Record<FonteKey, string>>({ fonte_5: '', fonte_45: '', fonte_4: '', fonte_44: '' });
  const [financeAccountId, setFinanceAccountId] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchConvenios = useCallback(async () => {
    const { data } = await supabase.from('convenios').select('*').order('nome');
    if (data) setConvenios(data as Convenio[]);
  }, []);

  useEffect(() => {
    fetchConvenios();
  }, [fetchConvenios]);

  useEffect(() => {
    if (accounts.length > 0 && !financeAccountId) {
      setFinanceAccountId(accounts.find(a => a.categoria === 'convenio')?.id || accounts[0].id);
    }
  }, [accounts, financeAccountId]);

  const resetForm = () => {
    setEditing(null);
    setNome('');
    setFontes({ fonte_5: '', fonte_45: '', fonte_4: '', fonte_44: '' });
    setFinanceAccountId('');
    setShowForm(false);
  };

  const startEdit = (conv: Convenio) => {
    setEditing(conv);
    setNome(conv.nome);
    setFontes({
      fonte_5: String(conv.fonte_5 || ''),
      fonte_45: String(conv.fonte_45 || ''),
      fonte_4: String(conv.fonte_4 || ''),
      fonte_44: String(conv.fonte_44 || ''),
    });
    setFinanceAccountId(conv.finance_account_id || '');
    setShowForm(true);
  };

  const subtotalConvenio = (c: Convenio) => toDecimal(c.fonte_5 || 0).plus(toDecimal(c.fonte_45 || 0)).toNumber();
  const subtotalContrapartida = (c: Convenio) => toDecimal(c.fonte_4 || 0).plus(toDecimal(c.fonte_44 || 0)).toNumber();
  const totalGeral = (c: Convenio) => toDecimal(subtotalConvenio(c)).plus(toDecimal(subtotalContrapartida(c))).toNumber();

  const handleSave = async () => {
    if (!nome.trim()) return;
    setSaving(true);
    const payload = {
      nome: nome.trim(),
      fonte_5: toDecimal(fontes.fonte_5 || 0).toNumber(),
      fonte_45: toDecimal(fontes.fonte_45 || 0).toNumber(),
      fonte_4: toDecimal(fontes.fonte_4 || 0).toNumber(),
      fonte_44: toDecimal(fontes.fonte_44 || 0).toNumber(),
      finance_account_id: financeAccountId || null,
    };
    if (editing) {
      await supabase.from('convenios').update(payload).eq('id', editing.id);
    } else {
      await supabase.from('convenios').insert(payload);
    }
    await fetchConvenios();
    setSaving(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    await supabase.from('convenios').delete().eq('id', id);
    setConvenios(convenios.filter(c => c.id !== id));
  };

  if (!currentBt) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Nenhum BT ativo" description="Crie um novo Boletim de Tesouraria para gerenciar os convênios." />
      </div>
    );
  }

  const activeAccounts = accounts.filter(a => a.ativo);
  const totalFonte5 = convenios.reduce((s, c) => s + (c.fonte_5 || 0), 0);
  const totalFonte45 = convenios.reduce((s, c) => s + (c.fonte_45 || 0), 0);
  const totalFonte4 = convenios.reduce((s, c) => s + (c.fonte_4 || 0), 0);
  const totalFonte44 = convenios.reduce((s, c) => s + (c.fonte_44 || 0), 0);
  const totalSubtotalConvenio = convenios.reduce((s, c) => s + subtotalConvenio(c), 0);
  const totalSubtotalContrapartida = convenios.reduce((s, c) => s + subtotalContrapartida(c), 0);
  const totalGeralConvenios = convenios.reduce((s, c) => s + totalGeral(c), 0);

  return (
    <>
    {fechado && <div className="px-6 pt-4"><BtFechadoBanner numero={currentBt?.numero ?? ''} /></div>}
    <BtFechadoGuard fechado={fechado}>
    <div className="p-6 space-y-4">
      {/* Header actions */}
      <Card className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Handshake className="w-5 h-5 text-blue-600" />
          <div>
            <h3 className="text-sm font-bold text-slate-800">Controle de Convênios</h3>
            <p className="text-xs text-slate-500 mt-0.5">Fontes orçamentárias 5/45 (Convênio) e 4/44 (Contrapartida)</p>
          </div>
        </div>
        <Button onClick={() => { if (showForm) resetForm(); else setShowForm(true); }}>
          <Plus className="w-4 h-4" /> {showForm ? 'Fechar Formulário' : 'Novo Convênio'}
        </Button>
      </Card>

      {/* Form */}
      {showForm && (
        <Card className="p-4">
          <p className="text-sm font-bold text-slate-700 mb-3">
            {editing ? `Editar Convênio: ${editing.nome}` : 'Novo Convênio'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Nome do Convênio">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: FUNDUNESP" autoFocus />
            </Field>
            <Field label="Conta Bancária Financeira">
              <Select value={financeAccountId} onChange={(e) => setFinanceAccountId(e.target.value)}>
                <option value="">Selecione...</option>
                {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </Select>
            </Field>
            {FONTES.map(f => (
              <Field key={f.key} label={`${f.label} (R$)`}>
                <Input
                  type="number"
                  step="0.01"
                  value={fontes[f.key]}
                  onChange={(e) => setFontes({ ...fontes, [f.key]: e.target.value })}
                  placeholder="0,00"
                />
              </Field>
            ))}
          </div>

          {/* Live subtotals */}
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-600 font-semibold">Subtotal Recursos do Convênio</p>
              <p className="text-base font-bold text-blue-700 mt-0.5">
                {formatCurrency(toDecimal(fontes.fonte_5 || 0).plus(toDecimal(fontes.fonte_45 || 0)).toNumber())}
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-600 font-semibold">Subtotal Contrapartida</p>
              <p className="text-base font-bold text-amber-700 mt-0.5">
                {formatCurrency(toDecimal(fontes.fonte_4 || 0).plus(toDecimal(fontes.fonte_44 || 0)).toNumber())}
              </p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="text-xs text-emerald-600 font-semibold">Total Geral do Convênio</p>
              <p className="text-base font-bold text-emerald-700 mt-0.5">
                {formatCurrency(toDecimal(fontes.fonte_5 || 0).plus(toDecimal(fontes.fonte_45 || 0)).plus(toDecimal(fontes.fonte_4 || 0)).plus(toDecimal(fontes.fonte_44 || 0)).toNumber())}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <Button variant="secondary" onClick={resetForm}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !nome.trim()}>
              {saving ? 'Salvando...' : editing ? 'Atualizar Convênio' : 'Criar Convênio'}
            </Button>
          </div>
        </Card>
      )}

      {/* Totals summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-xs text-slate-500">Subtotal Convênio (5+45)</p>
          <p className="text-base font-bold text-blue-700">{formatCurrency(totalSubtotalConvenio)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Subtotal Contrapartida (4+44)</p>
          <p className="text-base font-bold text-amber-700">{formatCurrency(totalSubtotalContrapartida)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Total Geral</p>
          <p className="text-base font-bold text-emerald-700">{formatCurrency(totalGeralConvenios)}</p>
        </Card>
      </div>

      {/* Convenios list */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-800">Convênios Cadastrados</h3>
          <p className="text-xs text-slate-500 mt-0.5">O Total Geral de cada convênio espelha na Conciliação Bancária</p>
        </div>
        {convenios.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">Nenhum convênio cadastrado</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-2 text-left font-semibold">Convênio</th>
                  <th className="px-4 py-2 text-right font-semibold">Fonte 5</th>
                  <th className="px-4 py-2 text-right font-semibold">Fonte 45</th>
                  <th className="px-4 py-2 text-right font-semibold font-medium">Fonte 4</th>
                  <th className="px-4 py-2 text-right font-semibold">Fonte 44</th>
                  <th className="px-4 py-2 text-right font-semibold">Subtot. Convênio</th>
                  <th className="px-4 py-2 text-right font-semibold">Subtot. Contrapartida</th>
                  <th className="px-4 py-2 text-right font-semibold">Total Geral</th>
                  <th className="px-4 py-2 text-left font-semibold">Conta Financeira</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {convenios.map(c => {
                  const finAcc = accounts.find(a => a.id === c.finance_account_id);
                  return (
                    <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50 group">
                      <td className="px-4 py-2.5 font-semibold text-slate-700">{c.nome}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{formatCurrency(c.fonte_5)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{formatCurrency(c.fonte_45)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{formatCurrency(c.fonte_4)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{formatCurrency(c.fonte_44)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-blue-700">{formatCurrency(subtotalConvenio(c))}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-amber-700">{formatCurrency(subtotalContrapartida(c))}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-emerald-700">{formatCurrency(totalGeral(c))}</td>
                      <td className="px-4 py-2.5">
                        {finAcc ? (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                            <Wallet className="w-3.5 h-3.5 text-slate-400" /> {finAcc.nome}
                          </span>
                        ) : (
                          <Badge color="slate">Não vinculada</Badge>
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEdit(c)} className="p-1 text-slate-400 hover:text-blue-600">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(c.id)} className="p-1 text-slate-400 hover:text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                  <td className="px-4 py-3 text-slate-800">TOTAL</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(totalFonte5)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(totalFonte45)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(totalFonte4)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(totalFonte44)}</td>
                  <td className="px-4 py-3 text-right text-blue-700">{formatCurrency(totalSubtotalConvenio)}</td>
                  <td className="px-4 py-3 text-right text-amber-700">{formatCurrency(totalSubtotalContrapartida)}</td>
                  <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(totalGeralConvenios)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
    </BtFechadoGuard>
    </>
  );
}
