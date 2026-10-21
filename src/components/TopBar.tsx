import { Calendar, Plus } from 'lucide-react';
import { formatDate } from '@/lib/format';

interface TopBarProps {
  title: string;
  subtitle?: string;
  btNumero: string | null;
  btData: string | null;
  onNewBt: () => void;
}

export default function TopBar({ title, subtitle, btNumero, btData, onNewBt }: TopBarProps) {
  return (
    <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
      <div>
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {btNumero && btData && (
          <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="font-medium">BT {btNumero}</span>
            <span className="text-slate-400">·</span>
            <span>{formatDate(btData)}</span>
          </div>
        )}
        <button
          onClick={onNewBt}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Novo BT
        </button>
      </div>
    </header>
  );
}
