import { useState } from 'react';
import Sidebar, { type PageKey } from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import NewBtModal from '@/components/NewBtModal';
import { BtProvider, useBt } from '@/context/BtContext';
import Dashboard from '@/pages/Dashboard';
import Movimentacao from '@/pages/Movimentacao';
import Conciliacao from '@/pages/Conciliacao';
import Convenios from '@/pages/Convenios';
import Receita from '@/pages/Receita';
import Fechamento from '@/pages/Fechamento';
import Relatorios from '@/pages/Relatorios';

const pageTitles: Record<PageKey, { title: string; subtitle: string }> = {
  dashboard: { title: 'Visão Geral', subtitle: 'Painel de controle do Boletim de Tesouraria' },
  receita: { title: 'Controle da Receita', subtitle: 'Subalíneas e Receitas Próprias (contábil e financeira)' },
  movimentacao: { title: 'Movimentações', subtitle: 'Registro de pagamentos e recebimentos por conta' },
  convenios: { title: 'Controle de Convênios', subtitle: 'Fontes orçamentárias 5/45/4/44 e vínculo financeiro' },
  conciliacao: { title: 'Conciliação Bancária', subtitle: 'Confronto entre saldo orçamentário e extrato bancário' },
  fechamento: { title: 'Fechamento Diário', subtitle: 'Validação e encerramento do BT' },
  relatorios: { title: 'Relatórios e PDF', subtitle: 'Visualização e exportação de Boletins de Tesouraria' },
};

function AppContent() {
  const { currentBt, refreshBt } = useBt();
  const [page, setPage] = useState<PageKey>('dashboard');
  const [showNewBt, setShowNewBt] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleActionFeedback = (msg: string) => {
    setFeedback(msg);
    window.setTimeout(() => setFeedback(null), 3000);
  };

  const meta = pageTitles[page];

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        current={page}
        onNavigate={setPage}
        btNumero={currentBt?.numero ?? null}
        btStatus={currentBt?.status ?? null}
        btId={currentBt?.id ?? null}
        onBtStatusChange={refreshBt}
        onActionFeedback={handleActionFeedback}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          title={meta.title}
          subtitle={meta.subtitle}
          btNumero={currentBt?.numero ?? null}
          btData={currentBt?.data ?? null}
          onNewBt={() => setShowNewBt(true)}
        />
        <main className="flex-1 overflow-y-auto relative">
          {feedback && (
            <div className="absolute top-3 right-6 z-20 bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg">
              {feedback}
            </div>
          )}
          {page === 'dashboard' && <Dashboard onNavigate={setPage} onNewBt={() => setShowNewBt(true)} />}
          {page === 'movimentacao' && <Movimentacao />}
          {page === 'convenios' && <Convenios />}
          {page === 'receita' && <Receita />}
          {page === 'conciliacao' && <Conciliacao />}
          {page === 'fechamento' && <Fechamento />}
          {page === 'relatorios' && <Relatorios onNavigate={setPage} />}
        </main>
      </div>
      <NewBtModal open={showNewBt} onClose={() => setShowNewBt(false)} />
    </div>
  );
}

export default function App() {
  return (
    <BtProvider>
      <AppContent />
    </BtProvider>
  );
}
