import { useState } from 'react';
import { AlertTriangle, RefreshCw, Check } from 'lucide-react';
import Modal from './ui/Modal';
import { Button, Badge } from './ui/Field';
import { useBt } from '@/context/BtContext';
import { computeSaldoFinalConta, getBtAnterior } from '@/lib/recalc';
import { sortAccounts } from '@/lib/sortAccounts';
import { formatCurrency } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Account, BtReport, Transaction } from '@/types';

interface Divergencia {
  acc: Account;
  saldoArmazenado: number;
  saldoNovo: number;
  diferenca: number;
}

interface AtualizarSaldoModalProps {
  open: boolean;
  onClose: () => void;
  bt: BtReport;
  onAtualizado: () => void;
}

export default function AtualizarSaldoModal({ open, onClose, bt, onAtualizado }: AtualizarSaldoModalProps) {
  const { accounts, updateSaldosReaberto } = useBt();
  const [loading, setLoading] = useState(false);
  const [divergencias, setDivergencias] = useState<Divergencia[] | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const sameCents = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

  const comparar = async () => {
    setLoading(true);
    setError('');
    try {
      const prev = await getBtAnterior(bt);
      if (!prev) {
        setError('Não há BT anterior para comparar.');
        setLoading(false);
        return;
      }
      const accs = sortAccounts(accounts.filter(a => a.ativo));

      // Saldo final consolidado de cada conta no BT anterior (fechado/corrigido)
      const finais = new Map<string, number>();
      for (const acc of accs) {
        const fin = await computeSaldoFinalConta(prev.id, acc);
        if (fin !== null) finais.set(acc.id, fin);
      }

      // Saldo inicial armazenado no BT reaberto (âncora "Saldo Anterior")
      const { data: anchors } = await supabase
        .from('transactions')
        .select('account_id, saldo_anterior')
        .eq('bt_report_id', bt.id)
        .eq('descricao', 'Saldo Anterior');
      const rows = (anchors || []) as Pick<Transaction, 'account_id' | 'saldo_anterior'>[];
      const armazenados = new Map<string, number>();
      for (const r of rows) {
        if (!armazenados.has(r.account_id)) armazenados.set(r.account_id, r.saldo_anterior || 0);
      }

      const diffs: Divergencia[] = [];
      for (const acc of accs) {
        const novo = finais.get(acc.id);
        if (novo === undefined) continue;
        const atual = armazenados.get(acc.id) ?? 0;
        if (sameCents(atual, novo)) continue;
        diffs.push({
          acc,
          saldoArmazenado: atual,
          saldoNovo: novo,
          diferenca: Math.round((novo - atual) * 100) / 100,
        });
      }
      setDivergencias(diffs);
    } catch (e) {
      setError('Erro ao comparar os saldos. Tente novamente.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const confirmar = async () => {
    setLoading(true);
    setError('');
    const failMsg = await updateSaldosReaberto(bt.id);
    setLoading(false);
    if (failMsg === null) {
      setDone(true);
      onAtualizado();
    } else {
      setError(failMsg);
    }
  };

  const close = () => {
    setDivergencias(null);
    setDone(false);
    setError('');
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Atualizar Saldo entre BTs" maxWidth="max-w-2xl">
      <div className="space-y-4">
        {done ? (
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-emerald-800">Saldos atualizados com sucesso!</p>
              <p className="text-xs text-emerald-700 mt-1">
                O saldo inicial deste BT agora reflete o saldo final do BT anterior. Siga a esteira: Salvar → Validar → Fechar BT.
              </p>
            </div>
          </div>
        ) : divergencias === null ? (
          <>
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <RefreshCw className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800">
                Esta comparação verifica, conta por conta, se o saldo final do BT anterior confere com o saldo inicial armazenado neste BT reaberto.
              </p>
            </div>
            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={close} disabled={loading}>Cancelar</Button>
              <Button onClick={comparar} disabled={loading}>
                {loading ? 'Comparando...' : 'Comparar Saldos'}
              </Button>
            </div>
          </>
        ) : divergencias.length === 0 ? (
          <>
            <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-800 font-medium">
                Todos os saldos iniciais conferem com o saldo final do BT anterior. Nenhuma atualização necessária.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={close}>Fechar</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                Foram encontradas diferenças entre o saldo final do BT anterior e o saldo inicial armazenado neste BT.
                {' '}Deseja atualizar o saldo inicial deste BT com base no saldo final do BT anterior?
              </p>
            </div>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wider">
                    <th className="px-3 py-2 text-left font-semibold">Conta</th>
                    <th className="px-3 py-2 text-right font-semibold">Saldo Inicial Armazenado</th>
                    <th className="px-3 py-2 text-right font-semibold">Novo Saldo Final (BT Anterior)</th>
                    <th className="px-3 py-2 text-right font-semibold">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {divergencias.map(d => (
                    <tr key={d.acc.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-700">{d.acc.nome}</p>
                        <p className="text-[10px] text-slate-400">{d.acc.codigo || '—'}</p>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(d.saldoArmazenado)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{formatCurrency(d.saldoNovo)}</td>
                      <td className="px-3 py-2 text-right">
                        <Badge color={d.diferenca >= 0 ? 'green' : 'red'}>
                          {d.diferenca >= 0 ? '+' : ''}{formatCurrency(d.diferenca)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={close} disabled={loading}>Cancelar</Button>
              <Button onClick={confirmar} disabled={loading}>
                {loading ? 'Atualizando...' : 'Confirmar e Atualizar Saldo'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
