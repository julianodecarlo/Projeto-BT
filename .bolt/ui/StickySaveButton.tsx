import { Save, Check } from 'lucide-react';

interface StickySaveButtonProps {
  /** true quando há alterações não salvas (botão laranja) */
  dirty: boolean;
  /** handler de salvamento */
  onSave: () => void | Promise<void>;
  /** rotulo do botão */
  label?: string;
  /** desabilita (ex.: BT fechado) */
  disabled?: boolean;
  /** "Salvando..." enquanto o salvamento está em curso */
  saving?: boolean;
}

// Botão de salvamento do cabeçalho fixo (TopBar): visível durante toda a
// rolagem da tela. Laranja = pendência de salvamento; verde = tudo sincronizado.
export default function StickySaveButton({ dirty, onSave, label = 'Salvar Lançamentos', disabled, saving }: StickySaveButtonProps) {
  const green = !dirty && !saving;
  const base = 'flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors shadow-sm border';
  const cls = green
    ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
    : 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500';
  return (
    <button
      onClick={() => { if (!disabled && !saving) void onSave(); }}
      disabled={disabled || saving}
      className={`${base} ${cls} disabled:opacity-50 disabled:cursor-not-allowed`}
      title={dirty ? 'Há alterações não salvas' : 'Tudo sincronizado'}
    >
      {green ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
      {saving ? 'Salvando...' : label}
    </button>
  );
}
