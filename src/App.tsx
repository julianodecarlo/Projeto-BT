import { lazy, Suspense, useState } from 'react';
import Sidebar, { type PageKey } from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import NewBtModal from '@/components/NewBtModal';
import { BtProvider, useBt } from '@/context/BtContext';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Movimentacao = lazy(() => import('@/pages/Movimentacao'));
const Conciliacao = lazy(() => import('@/pages/Conciliacao'));
const Convenios = lazy(() => import('@/pages/Convenios'));
const Receita = lazy(() => import('@/pages/Receita'));
const Fechamento = lazy(() => import('@/pages/Fechamento'));
const Relatorios = lazy(() => import('@/pages/Relatorios'));

const PageFallback = () => (
  <div className="flex items-center justify-center h-full min-h-[200px] text-sm text-slate-400">Carregando...</div>
);

const pageTitles: Record<PageKey, { title: string; subtitle: string }> = {
  dashboard: { title: 'Visão Geral', subtitle: 'Painel de controle do BT - Boletim de Tesouraria e Caixa' },
  receita: { title: 'Controle da Receita', subtitle: 'Subalíneas e Receitas Próprias (contábil e financeira)' },
  movimentacao: { title: 'Movimentações', subtitle: 'Registro de pagamentos e recebimentos por conta' },
  convenios: { title: 'Controle de Convênios', subtitle: 'Fontes orçamentárias 5/45/4/44 e vínculo financeiro' },
  conciliacao: { title: 'Conciliação Bancária', subtitle: 'Confronto entre saldo orçamentário e extrato bancário' },
  fechamento: { title: 'Fechamento Diário', subtitle: 'Validação e encerramento do BT' },
  relatorios: { title: 'Relatórios e PDF', subtitle: 'Visualização e exportação de BTs - Boletim de Tesouraria e Caixa' },
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
          <Suspense fallback={<PageFallback />}>
            {page === 'dashboard' && <Dashboard onNavigate={setPage} onNewBt={() => setShowNewBt(true)} />}
            {page === 'movimentacao' && <Movimentacao />}
            {page === 'convenios' && <Convenios />}
            {page === 'receita' && <Receita />}
            {page === 'conciliacao' && <Conciliacao />}
            {page === 'fechamento' && <Fechamento onNavigate={setPage} />}
            {page === 'relatorios' && <Relatorios onNavigate={setPage} />}
          </Suspense>
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
