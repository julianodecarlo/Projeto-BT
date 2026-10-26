import { useState } from 'react';
import Modal from './ui/Modal';
import { Button, Input, Field, Select } from './ui/Field';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import type { Account, AccountCategory } from '@/types';
import { Trash2, Pencil } from 'lucide-react';
import { MoneyInput } from './ui/MoneyInput';
import { sortAccounts } from '@/lib/sortAccounts';

interface AccountModalProps {
  open: boolean;
  onClose: () => void;
}

async function checkHasHistory(acc: Account): Promise<boolean | null> {
  try {
    const [txMov, txSaldo, cheques, deposits, payments, recon, revenue, convenio] = await Promise.all([
      supabase.from('transactions').select('id').eq('account_id', acc.id).neq('descricao', 'Saldo Anterior').limit(1),
      supabase.from('transactions').select('id').eq('account_id', acc.id).eq('descricao', 'Saldo Anterior').or('saldo_anterior.neq.0,saldo_final.neq.0').limit(1),
      supabase.from('cheques').select('id').eq('account_id', acc.id).limit(1),
      supabase.from('deposits_pending').select('id').eq('account_id', acc.id).limit(1),
      supabase.from('payments_pending').select('id').eq('account_id', acc.id).limit(1),
      supabase.from('reconciliation').select('id').eq('account_id', acc.id).limit(1),
      supabase.from('revenue_own').select('id').eq('account_id', acc.id).limit(1),
      supabase.from('convenios').select('id').eq('finance_account_id', acc.id).limit(1),
    ]);
    for (const res of [txMov, txSaldo, cheques, deposits, payments, recon, revenue, convenio]) {
      if (res.error) return null;
      if ((res.data ?? []).length > 0) return true;
    }
    return false;
  } catch {
    return null;
  }
}

const categoryLabels: Record<AccountCategory, string> = {
  movimento: 'Movimento',
  receita: 'Receita',
  diarias: 'Diárias',
  convenio: 'Convênio',
  caucao: 'Caução',
  deposito_judicial: 'Depósito Judicial',
};

export default function AccountModal({ open, onClose }: AccountModalProps) {
  const { accounts, refreshAccounts } = useBt();
  const [editing, setEditing] = useState<Account | null>(null);
  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [categoria, setCategoria] = useState<AccountCategory>('movimento');
  const [saldoInicial, setSaldoInicial] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [blockedAccount, setBlockedAccount] = useState<Account | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const resetForm = () => {
    setEditing(null);
    setNome('');
    setCodigo('');
    setCategoria('movimento');
    setSaldoInicial('');
  };

  const startEdit = (acc: Account) => {
    setEditing(acc);
    setNome(acc.nome);
    setCodigo(acc.codigo || '');
    setCategoria(acc.categoria);
    setSaldoInicial(String(acc.saldo_inicial || ''));
  };

  const handleSave = async () => {
    if (!nome.trim()) return;
    setSaving(true);
    const payload = {
      nome: nome.trim(),
      codigo: codigo.trim() || null,
      categoria,
      saldo_inicial: parseFloat(saldoInicial) || 0,
    };
    if (editing) {
      await supabase.from('accounts').update(payload).eq('id', editing.id);
    } else {
      const maxOrdem = accounts.length > 0 ? Math.max(...accounts.map(a => a.ordem)) : 0;
      await supabase.from('accounts').insert({ ...payload, ativo: true, ordem: maxOrdem + 1 });
    }
    await refreshAccounts();
    resetForm();
    setSaving(false);
  };

  const handleDeleteClick = async (acc: Account) => {
    setDeleteError('');
    const hasHistory = await checkHasHistory(acc);
    if (hasHistory === null) {
      setDeleteError('Não foi possível verificar o histórico da conta. Tente novamente.');
      return;
    }
    if (hasHistory) {
      setBlockedAccount(acc);
    } else {
      setDeleteTarget(acc);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const hasHistory = await checkHasHistory(deleteTarget);
    if (hasHistory === null) {
      setDeleteTarget(null);
      setDeleteError('Não foi possível verificar o histórico da conta. Tente novamente.');
      return;
    }
    if (hasHistory) {
      setBlockedAccount(deleteTarget);
      setDeleteTarget(null);
      return;
    }
    await supabase.from('accounts').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null);
    await refreshAccounts();
  };

  const handleToggle = async (acc: Account) => {
    await supabase.from('accounts').update({ ativo: !acc.ativo }).eq('id', acc.id);
    await refreshAccounts();
  };

  return (
    <Modal open={open} onClose={onClose} title="Gerenciar Contas" maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* Form */}
        <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
          <p className="text-sm font-bold text-slate-700 mb-3">
            {editing ? 'Editar Conta' : 'Nova Conta'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Nome da Conta">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Banco do Brasil - Movimento" autoFocus />
            </Field>
            <Field label="Número da Conta">
              <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex: 150000-8" />
            </Field>
            <Field label="Tipo de Conta">
              <Select value={categoria} onChange={(e) => setCategoria(e.target.value as AccountCategory)}>
                {Object.entries(categoryLabels).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Saldo Inicial (R$)">
              <MoneyInput value={Number(saldoInicial) || null} onValueChange={(v) => setSaldoInicial(v ? String(v) : '')} className="w-full px-3 py-2 text-sm" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            {editing && (
              <Button variant="ghost" onClick={resetForm}>Cancelar Edição</Button>
            )}
            <Button onClick={handleSave} disabled={saving || !nome.trim()}>
              {saving ? 'Salvando...' : editing ? 'Atualizar' : 'Adicionar Conta'}
            </Button>
          </div>
        </div>

        {/* List */}
        <div className="space-y-2">
          {sortAccounts(accounts).map(acc => (
            <div key={acc.id} className="flex items-center justify-between py-2.5 px-3 border border-slate-200 rounded-lg">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${acc.ativo ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <div>
                  <p className="text-sm font-medium text-slate-700">{acc.nome}</p>
                  <p className="text-xs text-slate-400">{acc.codigo} · {categoryLabels[acc.categoria]}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleToggle(acc)}
                  className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    acc.ativo ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {acc.ativo ? 'Ativa' : 'Inativa'}
                </button>
                <button
                  onClick={() => startEdit(acc)}
                  className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDeleteClick(acc)}
                  className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Concluir</Button>
        </div>
      </div>

      <Modal open={blockedAccount !== null} onClose={() => setBlockedAccount(null)} title="Exclusão bloqueada" maxWidth="max-w-md">
        <p className="text-sm text-slate-600 leading-relaxed">
          Esta conta possui movimentação ou vínculos no histórico e não pode ser excluída, para preservar a integridade dos dados. Desative a conta para que ela deixe de ser usada.
        </p>
        <div className="flex justify-end gap-2 mt-5">
          {blockedAccount?.ativo && (
            <Button onClick={() => { const acc = blockedAccount; setBlockedAccount(null); handleToggle(acc); }}>
              Desativar conta
            </Button>
          )}
          <Button variant="secondary" onClick={() => setBlockedAccount(null)}>Entendi</Button>
        </div>
      </Modal>

      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Excluir conta" maxWidth="max-w-md">
        <p className="text-sm text-slate-600 leading-relaxed">
          Excluir a conta '{deleteTarget?.nome}'? Esta conta não possui movimentações. A exclusão é irreversível.
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button onClick={confirmDelete} className="!bg-red-600 hover:!bg-red-700">
            Excluir Definitivamente
          </Button>
        </div>
      </Modal>

      <Modal open={deleteError !== ''} onClose={() => setDeleteError('')} title="Atenção" maxWidth="max-w-sm">
        <p className="text-sm text-slate-600 leading-relaxed">{deleteError}</p>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setDeleteError('')}>Entendi</Button>
        </div>
      </Modal>
    </Modal>
  );
}
