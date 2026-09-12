import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Wallet, FileText, ArrowRight, Calendar, Settings, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import { Card, Badge, Button } from '@/components/ui/Field';
import { formatCurrency, formatDate, sumDecimal, toNumber } from '@/lib/format';
import type { BtReport, Transaction } from '@/types';
import type { PageKey } from '@/components/Sidebar';
import AccountModal from '@/components/AccountModal';

interface DashboardProps {
  onNavigate: (page: PageKey) => void;
  onNewBt: () => void;
}

export default function Dashboard({ onNavigate, onNewBt }: DashboardProps) {
  const { currentBt, accounts, loading, setCurrentBt } = useBt();
  const [recentBts, setRecentBts] = useState<BtReport[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showAccountModal, setShowAccountModal] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: bts } = await supabase
        .from('bt_reports')
        .select('*')
        .order('data', { ascending: false })
        .limit(10);
      if (bts) setRecentBts(bts as BtReport[]);
      if (currentBt) {
        const { data: txs } = await supabase
          .from('transactions')
          .select('*')
          .eq('bt_report_id', currentBt.id)
          .order('ordem', { ascending: true });
        if (txs) setTransactions(txs as Transaction[]);
      }
    })();
  }, [currentBt]);

  const handleOpenBt = async (bt: BtReport) => {
    setCurrentBt(bt);
    onNavigate('movimentacao');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-slate-500">Carregando...</div>
      </div>
    );
  }

  const totalEntradas = toNumber(sumDecimal(transactions.filter(t => t.tipo_movimento === 'entrada').map(t => t.valor)));
  const totalSaidas = toNumber(sumDecimal(transactions.filter(t => t.tipo_movimento === 'saida').map(t => t.valor)));
  const saldoTotal = accounts.reduce((acc, a) => acc + (a.saldo_inicial || 0), 0);

  const stats = [
    { label: 'Saldo Total das Contas', value: formatCurrency(saldoTotal), icon: Wallet, color: 'blue' },
    { label: 'Total de Entradas (Hoje)', value: formatCurrency(totalEntradas), icon: TrendingUp, color: 'green' },
    { label: 'Total de Saídas (Hoje)', value: formatCurrency(totalSaidas), icon: TrendingDown, color: 'amber' },
    { label: 'BTs Emitidos', value: String(recentBts.length), icon: FileText, color: 'slate' },
  ];

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-100 text-slate-600',
  };

  return (
    <div className="p-6 space-y-6">
      {/* Hero section */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Boletim de Tesouraria</p>
            <h1 className="text-2xl font-bold mt-1">
              {currentBt ? `BT ${currentBt.numero}` : 'Nenhum BT ativo'}
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {currentBt ? formatDate(currentBt.data) : 'Crie um novo boletim para começar'}
            </p>
          </div>
          {currentBt && (
            <Badge color={currentBt.status === 'fechado' ? 'green' : currentBt.status === 'validado' ? 'amber' : 'slate'}>
              {currentBt.status === 'fechado' ? 'Fechado' : currentBt.status === 'validado' ? 'Validado' : 'Rascunho'}
            </Badge>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={onNewBt} className="bg-white/10 border-white/20 text-white hover:bg-white/20">
            <FileText className="w-4 h-4" /> Novo BT
          </Button>
          <Button variant="ghost" onClick={() => onNavigate('movimentacao')} className="text-white hover:bg-white/10">
            Nova Movimentação <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="p-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorMap[stat.color]}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">{stat.label}</p>
                  <p className="text-lg font-bold text-slate-800 mt-0.5">{stat.value}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Two columns: accounts + recent BTs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-800">Contas Cadastradas</h3>
            <Button size="sm" variant="secondary" onClick={() => setShowAccountModal(true)}>
              <Settings className="w-3.5 h-3.5" /> Gerenciar Contas
            </Button>
          </div>
          <div className="space-y-2">
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${acc.ativo ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <div>
                    <p className="text-sm font-medium text-slate-700">{acc.nome}</p>
                    <p className="text-xs text-slate-400">{acc.codigo}</p>
                  </div>
                </div>
                <span className="text-sm font-semibold text-slate-600">{formatCurrency(acc.saldo_inicial)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-4">BTs Recentes</h3>
          {recentBts.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">Nenhum BT criado ainda</p>
          ) : (
            <div className="space-y-2">
              {recentBts.map((bt) => (
                <div key={bt.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 group">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-700">BT {bt.numero}</p>
                      <p className="text-xs text-slate-400">{formatDate(bt.data)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge color={bt.status === 'fechado' ? 'green' : bt.status === 'validado' ? 'amber' : 'slate'}>
                      {bt.status === 'fechado' ? 'Fechado' : bt.status === 'validado' ? 'Validado' : 'Rascunho'}
                    </Badge>
                    <button
                      onClick={() => handleOpenBt(bt)}
                      className="p-1.5 text-slate-300 hover:text-blue-600 transition-colors opacity-0 group-hover:opacity-100"
                      title="Abrir e editar"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <AccountModal open={showAccountModal} onClose={() => setShowAccountModal(false)} />
    </div>
  );
}
