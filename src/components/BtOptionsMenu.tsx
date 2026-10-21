import { useState, useRef, useEffect } from 'react';
import { MoreVertical, Pencil, RotateCcw, Trash2, AlertTriangle } from 'lucide-react';
import Modal from './ui/Modal';
import { Field, Input, Button } from './ui/Field';
import { useBt } from '@/context/BtContext';
import type { BtReport } from '@/types';

interface BtOptionsMenuProps {
  bt: BtReport;
  onChanged?: () => void;
}

export default function BtOptionsMenu({ bt, onChanged }: BtOptionsMenuProps) {
  const { updateBt, reopenBt, deleteBt } = useBt();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const [showEdit, setShowEdit] = useState(false);
  const [showReopen, setShowReopen] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [numero, setNumero] = useState(bt.numero);
  const [data, setData] = useState(bt.data);
  const [dataFim, setDataFim] = useState(bt.data_fim || '');

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleEdit = async () => {
    if (!numero.trim() || !data) {
      setError('Preencha número e data');
      return;
    }
    if (dataFim && dataFim < data) {
      setError('A Data de Fim não pode ser anterior à Data de Início');
      return;
    }
    setSaving(true);
    setError('');
    const ok = await updateBt(bt.id, {
      numero: numero.trim(),
      data,
      data_fim: dataFim || null,
    });
    setSaving(false);
    if (ok) {
      setShowEdit(false);
      setOpen(false);
      onChanged?.();
    } else {
      setError('Erro ao atualizar BT. Tente novamente.');
    }
  };

  const handleReopen = async () => {
    setSaving(true);
    const ok = await reopenBt(bt.id);
    setSaving(false);
    if (ok) {
      setShowReopen(false);
      setOpen(false);
      onChanged?.();
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    const ok = await deleteBt(bt.id);
    setSaving(false);
    if (ok) {
      setShowDelete(false);
      setOpen(false);
      onChanged?.();
    }
  };

  const isFechado = bt.status === 'fechado';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        title="Opções do BT"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-20 w-52 bg-white rounded-lg shadow-xl border border-slate-200 py-1">
          <button
            onClick={() => { setShowEdit(true); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <Pencil className="w-4 h-4 text-slate-400" /> Editar
          </button>
          {isFechado && (
            <button
              onClick={() => { setShowReopen(true); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="w-4 h-4 text-amber-500" /> Reabrir para Ajustes
            </button>
          )}
          <button
            onClick={() => { setShowDelete(true); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" /> Excluir
          </button>
        </div>
      )}

      {/* Edit modal */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Editar BT ${bt.numero}`} maxWidth="max-w-md">
        <div className="space-y-4">
          <Field label="Número do BT">
            <Input value={numero} onChange={(e) => setNumero(e.target.value)} autoFocus />
          </Field>
          <Field label="Data de Início">
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </Field>
          <Field label="Data de Fim (opcional)">
            <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </Field>
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700">
              Alterar a data recalcula os saldos dos BTs subsequentes.
            </p>
          </div>
          {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setShowEdit(false)}>Cancelar</Button>
            <Button onClick={handleEdit} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        </div>
      </Modal>

      {/* Reopen modal */}
      <Modal open={showReopen} onClose={() => setShowReopen(false)} title="Reabrir BT para Ajustes" maxWidth="max-w-md">
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Reabrir BT {bt.numero}?</p>
              <p className="text-xs text-amber-700 mt-1">
                As alterações realizadas após a reabertura recalculam e afetam os saldos dos BTs subsequentes.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowReopen(false)}>Cancelar</Button>
            <Button onClick={handleReopen} disabled={saving}>{saving ? 'Reabrindo...' : 'Reabrir BT'}</Button>
          </div>
        </div>
      </Modal>

      {/* Delete modal */}
      <Modal open={showDelete} onClose={() => setShowDelete(false)} title="Excluir BT" maxWidth="max-w-md">
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-800">Tem certeza?</p>
              <p className="text-xs text-red-700 mt-1">
                Esta ação é irreversível e recalculará os saldos dos BTs posteriores.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowDelete(false)}>Cancelar</Button>
            <Button
              onClick={handleDelete}
              disabled={saving}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600"
            >
              {saving ? 'Excluindo...' : 'Excluir Definitivamente'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
