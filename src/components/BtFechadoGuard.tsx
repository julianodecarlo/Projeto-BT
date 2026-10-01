import { type ReactNode } from 'react';
import { Lock } from 'lucide-react';

interface BtFechadoGuardProps {
  fechado: boolean;
  children: ReactNode;
}

// Quando o BT está fechado, bloqueia toda interação de edição sobre o conteúdo.
export function BtFechadoGuard({ fechado, children }: BtFechadoGuardProps) {
  if (!fechado) return <>{children}</>;
  return (
    <div className="relative select-none">
      <div className="pointer-events-none opacity-60 grayscale">{children}</div>
      <div className="absolute inset-0 z-30 cursor-not-allowed" aria-hidden="true" />
    </div>
  );
}

export function BtFechadoBanner({ numero }: { numero: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-lg text-sm font-medium shadow-sm">
      <Lock className="w-4 h-4" />
      BT {numero} está Fechado — edição bloqueada em todas as abas. Reabra no Fechamento Diário para editar.
    </div>
  );
}
