import { useState } from 'react';
import Modal from './ui/Modal';
import { Field, Input, Button } from './ui/Field';
import { useBt } from '@/context/BtContext';
import { supabase } from '@/lib/supabase';
import { todayISO } from '@/lib/format';

interface NewBtModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export default function NewBtModal({ open, onClose, onCreated }: NewBtModalProps) {
  const { createBt } = useBt();
  const [numero, setNumero] = useState('');
  const [data, setData] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Normaliza removendo barras, pontos, hífens e zeros à esquerda: "001/2026" -> "12026"
  const normalizeNumero = (n: string) => n.replace(/[/.\-\s]/g, '').replace(/^0+/, '');

  const handleSave = async () => {
    if (!numero.trim() || !data) {
      setError('Preencha número e data');
      return;
    }
    setSaving(true);
    setError('');

    const { data: existing } = await supabase
      .from('bt_reports')
      .select('numero');
    const duplicado = (existing || []).some(
      (b: { numero: string }) => normalizeNumero(b.numero) === normalizeNumero(numero.trim())
    );
    if (duplicado) {
      setSaving(false);
      setError(`Já existe um BT com o número ${numero.trim()}.`);
      return;
    }

    const bt = await createBt(numero.trim(), data);
    setSaving(false);
    if (bt) {
      setNumero('');
      setData(todayISO());
      onClose();
      onCreated?.();
    } else {
      setError('Erro ao criar BT. Verifique sua conexão e tente novamente.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Novo Boletim de Tesouraria" maxWidth="max-w-md">
      <div className="space-y-4">
        <Field label="Número do BT">
          <Input
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="Ex: 001/2026"
            autoFocus
          />
        </Field>
        <Field label="Data da Movimentação">
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Criando...' : 'Criar BT'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
