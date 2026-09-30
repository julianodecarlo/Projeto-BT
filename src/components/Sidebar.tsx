import { LayoutDashboard, Wallet, FilePlus, Handshake, Scale, CheckCircle, FileText, Save, BadgeCheck, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export type PageKey = 'dashboard' | 'receita' | 'movimentacao' | 'convenios' | 'conciliacao' | 'fechamento' | 'relatorios';

interface SidebarProps {
  current: PageKey;
  onNavigate: (page: PageKey) => void;
  btNumero: string | null;
  btStatus: string | null;
  btId: string | null;
  onBtStatusChange: () => void;
  onActionFeedback: (msg: string) => void;
}

const navItems: { key: PageKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Visão Geral', icon: LayoutDashboard },
  { key: 'receita', label: 'Controle da Receita', icon: Wallet },
  { key: 'movimentacao', label: 'Movimentações', icon: FilePlus },
  { key: 'convenios', label: 'Controle de Convênios', icon: Handshake },
  { key: 'conciliacao', label: 'Conciliação Bancária', icon: Scale },
  { key: 'fechamento', label: 'Fechamento Diário', icon: CheckCircle },
  { key: 'relatorios', label: 'Relatórios e PDF', icon: FileText },
];

export default function Sidebar({ current, onNavigate, btNumero, btStatus, btId, onBtStatusChange, onActionFeedback }: SidebarProps) {
  const statusColor = btStatus === 'fechado' ? 'bg-emerald-500' : btStatus === 'validado' ? 'bg-amber-500' : 'bg-slate-400';
  const statusLabel = btStatus === 'fechado' ? 'Fechado' : btStatus === 'validado' ? 'Validado' : 'Rascunho';

  const salvarBt = async () => {
    if (!btId) return;
    await supabase.from('bt_reports').update({ status: 'rascunho' }).eq('id', btId);
    onBtStatusChange();
    onActionFeedback('BT salvo (rascunho).');
  };

  const validarBt = async () => {
    if (!btId) return;
    await supabase.from('bt_reports').update({ status: 'validado' }).eq('id', btId);
    onBtStatusChange();
    onActionFeedback('BT validado.');
  };

  const fecharBt = async () => {
    if (!btId) return;
    await supabase.from('bt_reports').update({ status: 'fechado' }).eq('id', btId);
    onBtStatusChange();
    onActionFeedback('BT fechado e salvo.');
  };

  return (
    <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">Boletim de Tesouraria</h1>
            <p className="text-[11px] text-slate-400">Controle Diário</p>
          </div>
        </div>
      </div>

      {btNumero && (
        <div className="px-5 py-3 border-b border-slate-800">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">BT Atual</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-bold text-white">BT {btNumero}</span>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white ${statusColor}`}>
              {statusLabel}
            </span>
          </div>
        </div>
      )}

      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = current === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon className={`w-4.5 h-4.5 ${active ? 'text-white' : 'text-slate-400'}`} style={{ width: 18, height: 18 }} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {btId && (
        <div className="px-2 py-3 border-t border-slate-800 space-y-1.5">
          <p className="px-3 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Ações do BT</p>
          <button
            onClick={salvarBt}
            disabled={btStatus === 'fechado'}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4 text-slate-400" />
            Salvar BT
          </button>
          <button
            onClick={validarBt}
            disabled={btStatus === 'fechado'}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-amber-400 hover:bg-slate-800 hover:text-amber-300 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <BadgeCheck className="w-4 h-4" />
            Validar BT
          </button>
          <button
            onClick={fecharBt}
            disabled={btStatus === 'fechado'}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-emerald-400 hover:bg-slate-800 hover:text-emerald-300 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Lock className="w-4 h-4" />
            Fechar BT (Finalizar e Salvar)
          </button>
        </div>
      )}

      <div className="px-5 py-3 border-t border-slate-800">
        <p className="text-[10px] text-slate-500">UNESP - Campus Botucatu</p>
        <p className="text-[10px] text-slate-600">Instituto de Biociências</p>
      </div>
    </aside>
  );
}
