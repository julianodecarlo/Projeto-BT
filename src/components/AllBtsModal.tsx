import { useState, useEffect, useCallback } from 'react';
import { Search, Calendar, Pencil, X } from 'lucide-react';
import Modal from './ui/Modal';
import { Input, Select, Button, Badge, EmptyState } from './ui/Field';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import { formatDate } from '@/lib/format';
import type { BtReport, BtStatus } from '@/types';
import BtOptionsMenu from './BtOptionsMenu';

interface AllBtsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AllBtsModal({ open, onClose }: AllBtsModalProps) {
  const { setCurrentBt } = useBt();
  const [bts, setBts] = useState<BtReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState<'todos' | BtStatus>('todos');
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchBts = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('bt_reports')
      .select('*')
      .order('data', { ascending: false });
    if (data) setBts(data as BtReport[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) fetchBts();
  }, [open, fetchBts, refreshKey]);

  const filtrados = bts.filter((bt) => {
    const matchBusca = bt.numero.toLowerCase().includes(busca.trim().toLowerCase());
    const matchStatus = statusFiltro === 'todos' || bt.status === statusFiltro;
    return matchBusca && matchStatus;
  });

  const handleOpenBt = (bt: BtReport) => {
    setCurrentBt(bt);
    onClose();
  };

  const statusBadge = (bt: BtReport) => (
    <Badge color={bt.status === 'fechado' ? 'green' : bt.status === 'validado' ? 'amber' : 'slate'}>
      {bt.status === 'fechado' ? 'Fechado' : bt.status === 'validado' ? 'Validado' : 'Rascunho'}
    </Badge>
  );

  return (
    <Modal open={open} onClose={onClose} title="Consultar Todos os BTs" maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por número do BT..."
              className="pl-9"
              autoFocus
            />
          </div>
          <Select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value as 'todos' | BtStatus)} className="w-40">
            <option value="todos">Todos os status</option>
            <option value="rascunho">Rascunho</option>
            <option value="validado">Validado</option>
            <option value="fechado">Fechado</option>
          </Select>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400 text-center py-8">Carregando BTs...</p>
        ) : filtrados.length === 0 ? (
          <EmptyState icon={Calendar} title="Nenhum BT encontrado" description="Ajuste a busca ou os filtros." />
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-1.5">
            {filtrados.map((bt) => (
              <div
                key={bt.id}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">BT {bt.numero}</p>
                    <p className="text-xs text-slate-400">
                      {formatDate(bt.data)}
                      {bt.data_fim ? ` até ${formatDate(bt.data_fim)}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {statusBadge(bt)}
                  <button
                    onClick={() => handleOpenBt(bt)}
                    className="p-1.5 text-slate-300 hover:text-blue-600 transition-colors"
                    title="Abrir este BT"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <BtOptionsMenu bt={bt} onChanged={() => setRefreshKey((k) => k + 1)} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="secondary" onClick={onClose}>
            <X className="w-3.5 h-3.5" /> Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
