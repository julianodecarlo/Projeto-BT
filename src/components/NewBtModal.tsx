import { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import { Field, Input, Button } from './ui/Field';
import { useBt } from '@/context/BtContext';
import { supabase } from '@/lib/supabase';
import { todayISO } from '@/lib/format';
import { nextNumeroFor, parseNumero, formatNumero, isValidFormatoNumero } from '@/lib/btNumero';
import type { BtReport } from '@/types';

interface NewBtModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export default function NewBtModal({ open, onClose, onCreated }: NewBtModalProps) {
  const { createBt } = useBt();
  const [numero, setNumero] = useState('');
  const [data, setData] = useState(todayISO());
  const [dataFim, setDataFim] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [bts, setBts] = useState<Pick<BtReport, 'numero'>[]>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.from('bt_reports').select('numero');
      const list = (data as Pick<BtReport, 'numero'>[]) || [];
      setBts(list);
      // Sugere o próximo número do ano atual (ou do ano do último BT)
      const ano = data && data.length > 0
        ? parseNumero(data[data.length - 1].numero)?.ano ?? new Date().getFullYear()
        : new Date().getFullYear();
      setNumero(nextNumeroFor(ano, list));
    })();
  }, [open]);

  // Normaliza removendo barras, pontos, hífens e zeros à esquerda: "001/2026" -> "12026"
  const normalizeNumero = (n: string) => n.replace(/[/.\-\s]/g, '').replace(/^0+/, '');

  const handleSave = async () => {
    if (!numero.trim() || !data) {
      setError('Preencha número e data de início');
      return;
    }
    if (!isValidFormatoNumero(numero)) {
      setError('Use o formato XXX/XXXX (ex: 001/2026)');
      return;
    }
    const parsed = parseNumero(numero);
    const anoData = parseInt(data.slice(0, 4), 10);
    if (parsed && parsed.ano !== anoData) {
      setError(`O ano do número (${parsed.ano}) deve ser igual ao ano da Data de Início (${anoData}).`);
      return;
    }
    if (dataFim && dataFim < data) {
      setError('A Data de Fim não pode ser anterior à Data de Início');
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

    const bt = await createBt(numero.trim(), data, dataFim || null);
    setSaving(false);
    if (bt) {
      setNumero('');
      setData(todayISO());
      setDataFim('');
      onClose();
      onCreated?.();
    } else {
      setError('Erro ao criar BT. Verifique sua conexão e tente novamente.');
    }
  };

  // Revalida ano quando a data muda e corrige a sugestão
  const handleDataChange = (novaData: string) => {
    setData(novaData);
    if (novaData) {
      const anoData = parseInt(novaData.slice(0, 4), 10);
      const parsed = parseNumero(numero);
      if (parsed && parsed.ano !== anoData) {
        setNumero(formatNumero(parsed.seq, anoData));
      }
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
        <Field label="Data de Início">
          <Input type="date" value={data} onChange={(e) => handleDataChange(e.target.value)} />
        </Field>
        <Field label="Data de Fim (opcional)">
          <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} min={data} />
        </Field>
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
          Caso a Data de Fim não seja preenchida, o sistema considerará apenas a Data de Início (BT de 1 dia).
        </p>
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
