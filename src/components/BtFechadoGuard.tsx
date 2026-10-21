import { type ReactNode } from 'react';
import { Lock } from 'lucide-react';

interface BtFechadoGuardProps {
  fechado: boolean;
  children: ReactNode;
}

// Em modo somente leitura o conteúdo NÃO é mais coberto por uma camada com
// pointer-events: none — isso congelava cards de consulta (BTs Recentes,
// "Ver Todos") e impedia a troca de BT. A leitura e a navegação permanecem
// livres; a edição é bloqueada individualmente por disabled={fechado} em
// cada botão/campo de gravação nas páginas.
export function BtFechadoGuard({ fechado, children }: BtFechadoGuardProps) {
  if (!fechado) return <>{children}</>;
  return <>{children}</>;
}

export function BtFechadoBanner({ numero }: { numero: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-lg text-sm font-medium shadow-sm">
      <Lock className="w-4 h-4 flex-shrink-0" />
      BT {numero} está Fechado — Modo Somente Leitura. Consulta e auditoria liberadas; reabra no Fechamento Diário para editar.
    </div>
  );
}
