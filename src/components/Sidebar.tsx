import { LayoutDashboard, Wallet, FilePlus, Handshake, Scale, CheckCircle, FileText, Save, BadgeCheck, Lock, AlertTriangle, Check } from 'lucide-react';
import { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import { Button } from './ui/Field';
import { useBt } from '@/context/BtContext';
import type { PendenciaItem } from '@/lib/validacao';
import { hasUnsavedGuard, subscribeUnsavedGuard, discardUnsaved, runUnsavedSavers } from '@/lib/unsavedGuard';

export type PageKey = 'dashboard' | 'receita' | 'movimentacao' | 'convenios' | 'conciliacao' | 'fechamento' | 'relatorios';

interface SidebarProps {
  current: PageKey;
  onNavigate: (page: PageKey) => void;
}

export default function Sidebar({ current, onNavigate }: SidebarProps) {
  const { currentBt, salvarBtRascunho, validarBtAtual, fecharBtAtual } = useBt();
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<'success' | 'error'>('success');
  const [pendencias, setPendencias] = useState<PendenciaItem[] | null>(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNavigate, setPendingNavigate] = useState<PageKey | null>(null);
  // Fluxo do botão Salvar: salvando → confirmação visual → navega.
  const [savingPending, setSavingPending] = useState(false);
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const [guardTick, setGuardTick] = useState(0);
  void guardTick;

  // Mantém o botão Salvar reativo ao estado "sujo" da aba de movimentações.
  useEffect(() => subscribeUnsavedGuard(() => setGuardTick(t => t + 1)), []);

  const btStatus = currentBt?.status ?? null;
  const btNumero = currentBt?.numero ?? null;
  const statusColor = btStatus === 'fechado' ? 'bg-emerald-500' : btStatus === 'validado' ? 'bg-amber-500' : 'bg-slate-400';
  const statusLabel = btStatus === 'fechado' ? 'Fechado' : btStatus === 'validado' ? 'Validado' : 'Rascunho';

  const showFeedback = (msg: string, type: 'success' | 'error' = 'success') => {
    setFeedback(msg);
    setFeedbackType(type);
    window.setTimeout(() => setFeedback(null), 3500);
  };

  const isFechado = btStatus === 'fechado';

  const handleSalvar = async () => {
    setSaving(true);
    const ok = await salvarBtRascunho();
    setSaving(false);
    if (ok) showFeedback('BT salvo com sucesso como rascunho');
    else showFeedback('Não foi possível salvar o BT. Tente novamente.', 'error');
  };

  const handleValidar = async () => {
    setSaving(true);
    const pend = await validarBtAtual();
    setSaving(false);
    if (pend.length > 0) {
      // Modal (z-index global) APENAS quando há pendências que impedem o fechamento.
      setPendencias(pend);
      onNavigate('fechamento');
    } else {
      // Sem pendências: nenhuma sobreposição — apenas Toast e navegação limpa.
      showFeedback('Boletim validado com sucesso!');
      onNavigate('fechamento');
    }
  };

  const handleFechar = async () => {
    setSaving(true);
    const pend = await fecharBtAtual();
    setSaving(false);
    if (pend.length > 0) {
      setPendencias(pend);
      onNavigate('fechamento');
      showFeedback('O BT não pode ser fechado: há pendências impeditivas.', 'error');
    } else {
      showFeedback('BT fechado e salvo. Modo somente leitura ativado.');
    }
  };

  // Navegação com barreira: se há valores digitados não salvos em qualquer aba
  // protegida, interrompe e pede confirmação antes de trocar de aba.
  const handleNavigate = (page: PageKey) => {
    if (hasUnsavedGuard() && page !== current) {
      setPendingNavigate(page);
      setSaveSucceeded(false);
      setShowUnsavedModal(true);
      return;
    }
    onNavigate(page);
  };

  return (
    <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">BT - Boletim de Tesouraria e Caixa</h1>
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
        {([
          { key: 'dashboard', label: 'Visão Geral', icon: LayoutDashboard },
          { key: 'receita', label: 'Controle da Receita', icon: Wallet },
          { key: 'movimentacao', label: 'Movimentações', icon: FilePlus },
          { key: 'convenios', label: 'Controle de Convênios', icon: Handshake },
          { key: 'conciliacao', label: 'Conciliação Bancária', icon: Scale },
          { key: 'fechamento', label: 'Fechamento Diário', icon: CheckCircle },
          { key: 'relatorios', label: 'Relatórios e PDF', icon: FileText },
        ] as { key: PageKey; label: string; icon: typeof LayoutDashboard }[]).map((item) => {
          const Icon = item.icon;
          const active = current === item.key;
          return (
            <button
              key={item.key}
              onClick={() => handleNavigate(item.key)}
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

      {currentBt && (
        <div className="px-2 py-3 border-t border-slate-800 space-y-1.5">
          <p className="px-3 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Ações do BT</p>
          <button
            onClick={handleSalvar}
            disabled={saving || isFechado}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4 text-slate-400" />
            {saving ? 'Salvando...' : 'Salvar BT'}
          </button>
          <button
            onClick={handleValidar}
            disabled={saving || isFechado}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-amber-400 hover:bg-slate-800 hover:text-amber-300 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <BadgeCheck className="w-4 h-4" />
            Validar BT
          </button>
          <button
            onClick={handleFechar}
            disabled={saving || isFechado}
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

      {/* Toast flutuante da barra lateral */}
      {feedback && (
        <div className={`fixed bottom-6 left-6 z-50 max-w-sm px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          feedbackType === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          <div className="flex items-start gap-2">
            {feedbackType === 'error' && <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
            {feedback}
          </div>
        </div>
      )}

      {/* Modal de alterações não salvas (3 opções) */}
      <Modal open={showUnsavedModal} onClose={() => { if (!savingPending) { setShowUnsavedModal(false); setPendingNavigate(null); setSaveSucceeded(false); } }} title="Alterações não salvas" maxWidth="max-w-md">
        <div className="space-y-4">
          {saveSucceeded ? (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <Check className="w-5 h-5 text-emerald-600 shrink-0" />
              <p className="text-sm text-emerald-800 font-medium">Salvo com sucesso!</p>
            </div>
          ) : (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800 font-medium">
                Você possui valores digitados que ainda não foram salvos. Deseja salvar antes de sair?
              </p>
            </div>
          )}
          {!saveSucceeded && (
            <div className="flex justify-end gap-2 pt-1 flex-wrap">
              <Button
                onClick={async () => {
                  setSavingPending(true);
                  const ok = await runUnsavedSavers();
                  setSavingPending(false);
                  if (ok) {
                    // Confirmação visível no modal; fecha e navega após 1,8s.
                    setSaveSucceeded(true);
                    window.setTimeout(() => {
                      setSaveSucceeded(false);
                      setShowUnsavedModal(false);
                      const dest = pendingNavigate;
                      setPendingNavigate(null);
                      if (dest) onNavigate(dest);
                    }, 1800);
                  } else {
                    showFeedback('Não foi possível salvar. Verifique os valores digitados.', 'error');
                  }
                }}
                disabled={savingPending}
              >
                {savingPending ? 'Salvando...' : 'Salvar'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  discardUnsaved();
                  setShowUnsavedModal(false);
                  if (pendingNavigate) {
                    onNavigate(pendingNavigate);
                    setPendingNavigate(null);
                  }
                }}
                disabled={savingPending}
              >
                Sair sem Salvar
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowUnsavedModal(false);
                  setPendingNavigate(null);
                }}
                disabled={savingPending}
              >
                Continuar Editando
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal de pendências impeditivas */}
      <Modal open={pendencias !== null} onClose={() => setPendencias(null)} title="Pendências impeditivas" maxWidth="max-w-lg">
        <div className="space-y-3">
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 font-medium">
              O BT não pode ser validado/fechado enquanto estas pendências abaixo existirem.
            </p>
          </div>
          <ul className="space-y-2">
            {(pendencias ?? []).map((p, i) => (
              <li key={i} className="border border-slate-200 rounded-lg p-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{p.location}</p>
                <p className="text-sm text-slate-700 mt-0.5">{p.message}</p>
              </li>
            ))}
          </ul>
          <div className="flex justify-end pt-1">
            <Button variant="secondary" onClick={() => setPendencias(null)}>Entendido</Button>
          </div>
        </div>
      </Modal>
    </aside>
  );
}
