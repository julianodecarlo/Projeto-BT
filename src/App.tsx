import { useState } from 'react';
import Sidebar, { type PageKey } from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import NewBtModal from '@/components/NewBtModal';
import { BtProvider, useBt } from '@/context/BtContext';
import Dashboard from '@/pages/Dashboard';
import Movimentacao from '@/pages/Movimentacao';
import Conciliacao from '@/pages/Conciliacao';
import Convenios from '@/pages/Convenios';
import Fechamento from '@/pages/Fechamento';
import Relatorios from '@/pages/Relatorios';

const pageTitles: Record<PageKey, { title: string; subtitle: string }> = {
  dashboard: { title: 'Visão Geral', subtitle: 'Painel de controle do Boletim de Tesouraria' },
  movimentacao: { title: 'Nova Movimentação', subtitle: 'Registro de pagamentos e recebimentos por conta' },
  conciliacao: { title: 'Conciliação Bancária', subtitle: 'Confronto entre saldo orçamentário e extrato bancário' },
  convenios: { title: 'Convênios e Receitas', subtitle: 'Gestão de convênios e receitas próprias (contábil e financeira)' },
  fechamento: { title: 'Fechamento Diário', subtitle: 'Validação e encerramento do BT' },
  relatorios: { title: 'Relatórios e PDF', subtitle: 'Visualização e exportação de Boletins de Tesouraria' },
};

function AppContent() {
  const { currentBt } = useBt();
  const [page, setPage] = useState<PageKey>('dashboard');
  const [showNewBt, setShowNewBt] = useState(false);

  const meta = pageTitles[page];

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        current={page}
        onNavigate={setPage}
        btNumero={currentBt?.numero ?? null}
        btStatus={currentBt?.status ?? null}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          title={meta.title}
          subtitle={meta.subtitle}
          btNumero={currentBt?.numero ?? null}
          btData={currentBt?.data ?? null}
          onNewBt={() => setShowNewBt(true)}
        />
        <main className="flex-1 overflow-y-auto">
          {page === 'dashboard' && <Dashboard onNavigate={setPage} onNewBt={() => setShowNewBt(true)} />}
          {page === 'movimentacao' && <Movimentacao />}
          {page === 'conciliacao' && <Conciliacao />}
          {page === 'convenios' && <Convenios />}
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
