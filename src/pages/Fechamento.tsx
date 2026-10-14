import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, AlertTriangle, FileText, Lock, Save, Unlock, UserCheck, ArrowRight } from 'lucide-react';
import { useBt } from '@/context/BtContext';
import { Card, Button, Input, Field, Badge, EmptyState } from '@/components/ui/Field';
import { formatCurrency, toDecimal, toNumber, sumDecimal, formatDate } from '@/lib/format';
import { getOpenItems, pendenciasPorConta, calcularStatusConciliacao } from '@/lib/reconStatus';
import type { Transaction, RevenueOwn, Cheque, DepositPending, BtReport, PaymentPending, PendencyResolution } from '@/types';
import { listTransactions } from '@/services/transactionService';
import { listRevenues } from '@/services/revenueService';
import { fetchPendencyData, listBtMeta } from '@/services/reconciliationService';
import { fetchBtBefore, updateBtSignatures, setBtStatus } from '@/services/btService';

interface ValidationCheck {
  label: string;
  passed: boolean;
  detail: string;
}

interface PendingItem {
  location: string;
  message: string;
  goTo: PageKey;
  goToLabel: string;
}

type PageKey = 'dashboard' | 'receita' | 'movimentacao' | 'convenios' | 'conciliacao' | 'fechamento' | 'relatorios';

export default function Fechamento({ onNavigate }: { onNavigate?: (page: PageKey) => void }) {
  const { currentBt, accounts, reconciliations, refreshBt, cascadeRecalculate } = useBt();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [revenues, setRevenues] = useState<RevenueOwn[]>([]);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [deposits, setDeposits] = useState<DepositPending[]>([]);
  const [payments, setPayments] = useState<PaymentPending[]>([]);
  const [resolutions, setResolutions] = useState<PendencyResolution[]>([]);
  const [allBts, setAllBts] = useState<Pick<BtReport, 'id' | 'data'>[]>([]);
  const [elaboradoPor, setElaboradoPor] = useState('');
  const [cargoElaborado, setCargoElaborado] = useState('');
  const [conferidoPor, setConferidoPor] = useState('');
  const [cargoConferido, setCargoConferido] = useState('');
  const [closing, setClosing] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [btAnterior, setBtAnterior] = useState<BtReport | null>(null);

  const fetchAll = useCallback(async () => {
    if (!currentBt) return;
    const [txs, revs, pendency, bts] = await Promise.all([
      listTransactions(currentBt.id),
      listRevenues(currentBt.id),
      fetchPendencyData(),
      listBtMeta(),
    ]);
    setTransactions(txs);
    setRevenues(revs);
    setCheques(pendency.cheques);
    setDeposits(pendency.deposits);
    setPayments(pendency.payments);
    setResolutions(pendency.resolutions);
    setAllBts(bts.map(b => ({ id: b.id, data: b.data })));
    setElaboradoPor(currentBt.elaborado_por || '');
    setCargoElaborado(currentBt.cargo_elaborado || '');
    setConferidoPor(currentBt.conferido_por || '');
    setCargoConferido(currentBt.cargo_conferido || '');
  }, [currentBt]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Busca o BT anterior (data imediatamente anterior à do BT atual) para importar assinaturas
  const fetchBtAnterior = useCallback(async () => {
    if (!currentBt) return;
    setBtAnterior(await fetchBtBefore(currentBt.data));
  }, [currentBt]);

  useEffect(() => {
    fetchBtAnterior();
  }, [fetchBtAnterior]);

  // Herança automática: ao abrir um BT novo com campos vazios, importa do BT
  // anterior e já grava no banco — o fechamento não exige reabrir o modal e
  // salvar quando os dados herdados estão completos.
  const handleImportSignatures = async () => {
    if (!btAnterior || !currentBt) return;
    const next = {
      elaborado: !elaboradoPor.trim() ? (btAnterior.elaborado_por || '') : elaboradoPor,
      cargoElab: !cargoElaborado.trim() ? (btAnterior.cargo_elaborado || '') : cargoElaborado,
      conferido: !conferidoPor.trim() ? (btAnterior.conferido_por || '') : conferidoPor,
      cargoConf: !cargoConferido.trim() ? (btAnterior.cargo_conferido || '') : cargoConferido,
    };
    setElaboradoPor(next.elaborado);
    setCargoElaborado(next.cargoElab);
    setConferidoPor(next.conferido);
    setCargoConferido(next.cargoConf);
    await updateBtSignatures(currentBt.id, {
      elaborado_por: next.elaborado.trim() || null,
      cargo_elaborado: next.cargoElab.trim() || null,
      conferido_por: next.conferido.trim() || null,
      cargo_conferido: next.cargoConf.trim() || null,
    });
    await refreshBt();
  };

  useEffect(() => {
    if (btAnterior) handleImportSignatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btAnterior]);

  if (!currentBt) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Nenhum BT ativo" description="Crie um novo Boletim de Tesouraria para realizar o fechamento diário." />
      </div>
    );
  }

  // Validation checks
  const checks: ValidationCheck[] = [];

  checks.push({
    label: 'Movimentações registradas',
    passed: transactions.length > 0,
    detail: transactions.length > 0 ? `${transactions.length} lançamento(s)` : 'Nenhuma movimentação registrada',
  });

  const balanceOk = transactions.every(t => {
    const expected = t.tipo_movimento === 'entrada'
      ? toDecimal(t.saldo_anterior).plus(toDecimal(t.valor)).toNumber()
      : toDecimal(t.saldo_anterior).minus(toDecimal(t.valor)).toNumber();
    return Math.abs(expected - t.saldo_final) < 0.01;
  });
  checks.push({
    label: 'Saldos corridos consistentes',
    passed: balanceOk,
    detail: balanceOk ? 'Todos os saldos estão consistentes' : 'Há inconsistência nos saldos corridos',
  });

  // FONTE ÚNICA: status calculado pela MESMA função da aba Conciliação
  // (calcularStatusConciliacao), sobre os objetos reconciliation do BtContext.
  // Reativo: ao digitar Extrato/Rendimentos na Conciliação, o Fechamento
  // reavalia instantaneamente porque reconciliations e openItems mudam.
  const openItems = getOpenItems(
    { cheques, deposits, payments, resolutions },
    { id: currentBt.id, data: currentBt.data },
    allBts
  );
  const pendMap = pendenciasPorConta(openItems);
  const statusPorConta = calcularStatusConciliacao({ accounts, transactions, reconciliations, pendMap });

  // Uma conta só entra no quadro de pendências se o badge atual da Conciliação
  // for efetivamente 'Divergente' ou 'Pendente' (com movimento no BT).
  const accountsWithTx = new Set(transactions.map(t => t.account_id));
  const divergentRecon = statusPorConta.filter(x => x.status === 'Divergente' && !x.isConvenio);
  const divergentConvenios = statusPorConta.filter(x => x.status === 'Divergente' && x.isConvenio);
  const accountsWithoutRecon = statusPorConta.filter(
    x => x.status === 'Pendente' && accountsWithTx.has(x.acc.id) && !x.isConvenio
  );
  const conciliacaoOk = divergentRecon.length === 0 && accountsWithoutRecon.length === 0;
  checks.push({
    label: 'Conciliação bancária sem divergências',
    passed: conciliacaoOk,
    detail: conciliacaoOk
      ? divergentConvenios.length > 0
        ? `Contas de movimento conciliadas · ${divergentConvenios.length} convênio(s) divergente(s) (conciliação periódica, não impede o fechamento)`
        : 'Todas as contas ativas conciliadas'
      : [
          divergentRecon.length > 0 ? `${divergentRecon.length} conta(s) com divergência` : '',
          accountsWithoutRecon.length > 0 ? `${accountsWithoutRecon.length} conta(s) sem conciliação` : '',
        ].filter(Boolean).join(' · '),
  });

  const hasContabil = revenues.some(r => r.tipo === 'contabil');
  const hasFinanceira = revenues.some(r => r.tipo === 'financeira');
  checks.push({
    label: 'Receitas Próprias preenchidas',
    passed: hasContabil || hasFinanceira,
    detail: hasContabil && hasFinanceira
      ? 'Contábil e Financeira preenchidas'
      : hasContabil
        ? 'Apenas Contábil preenchida'
        : hasFinanceira
          ? 'Apenas Financeira preenchida'
          : 'Nenhuma receita própria registrada',
  });

  checks.push({
    label: 'Assinaturas preenchidas',
    passed: elaboradoPor.trim() !== '' && conferidoPor.trim() !== '',
    detail: elaboradoPor.trim() && conferidoPor.trim()
      ? 'Elaborado e conferido por preenchidos'
      : 'Preencha os campos de assinatura',
  });

  const allPassed = checks.every(c => c.passed);
  const isFechado = currentBt.status === 'fechado';

  // Lista detalhada de pendências com localização e atalho de navegação.
  // A diferença exibida é EXATAMENTE a do badge da Conciliação (x.dif).
  const pendingItems: PendingItem[] = [];
  for (const x of divergentRecon) {
    pendingItems.push({
      location: `Conciliação Bancária - Conta ${x.acc.nome ?? '—'}`,
      message: `Saldo com divergência de ${formatCurrency(x.dif)} entre Extrato e BT.`,
      goTo: 'conciliacao',
      goToLabel: 'Ir para Conciliação',
    });
  }
  for (const x of accountsWithoutRecon) {
    pendingItems.push({
      location: `Conciliação Bancária - Conta ${x.acc.nome}`,
      message: 'Conta com movimento no BT sem conciliação registrada.',
      goTo: 'conciliacao',
      goToLabel: 'Ir para Conciliação',
    });
  }
  if (!balanceOk) {
    pendingItems.push({
      location: 'Movimentações',
      message: 'Há inconsistência nos saldos corridos (saldo anterior + entrada − saída ≠ saldo final).',
      goTo: 'movimentacao',
      goToLabel: 'Ir para Movimentações',
    });
  }
  if (transactions.length === 0) {
    pendingItems.push({
      location: 'Movimentações',
      message: 'Nenhuma movimentação registrada no BT.',
      goTo: 'movimentacao',
      goToLabel: 'Ir para Movimentações',
    });
  }
  if (!hasContabil || !hasFinanceira) {
    pendingItems.push({
      location: 'Controle da Receita',
      message: !hasContabil && !hasFinanceira
        ? 'Nenhuma receita própria registrada (contábil e financeira).'
        : !hasContabil
          ? 'Receitas Próprias Contábil não preenchidas.'
          : 'Receitas Próprias Financeira não preenchidas.',
      goTo: 'receita',
      goToLabel: 'Ir para Controle da Receita',
    });
  }
  if (elaboradoPor.trim() === '' || conferidoPor.trim() === '') {
    pendingItems.push({
      location: 'Fechamento Diário',
      message: 'Assinaturas de elaboração e/ou conferência não preenchidas.',
      goTo: 'fechamento',
      goToLabel: 'Preencher abaixo',
    });
  }

  const handleSaveSignatures = async () => {
    if (!currentBt) return;
    await updateBtSignatures(currentBt.id, {
      elaborado_por: elaboradoPor.trim() || null,
      cargo_elaborado: cargoElaborado.trim() || null,
      conferido_por: conferidoPor.trim() || null,
      cargo_conferido: cargoConferido.trim() || null,
    });
    await refreshBt();
  };

  const handleClose = async () => {
    if (!currentBt || !allPassed) return;
    setClosing(true);
    await setBtStatus(currentBt.id, 'fechado');
    await refreshBt();
    await fetchAll();
    setClosing(false);
  };

  const handleValidate = async () => {
    if (!currentBt) return;
    await setBtStatus(currentBt.id, 'validado');
    await refreshBt();
  };

  const handleReopen = async () => {
    if (!currentBt) return;
    await setBtStatus(currentBt.id, 'rascunho');
    await refreshBt();
    await fetchAll();
  };

  const handleRecalculate = async () => {
    if (!currentBt) return;
    setRecalculating(true);
    await cascadeRecalculate(currentBt.id);
    await fetchAll();
    setRecalculating(false);
  };

  const totalEntradas = toNumber(sumDecimal(transactions.filter(t => t.tipo_movimento === 'entrada').map(t => t.valor)));
  const totalSaidas = toNumber(sumDecimal(transactions.filter(t => t.tipo_movimento === 'saida').map(t => t.valor)));
  const totalChequesCompensar = toNumber(sumDecimal(cheques.filter(c => c.status === 'a_compensar').map(c => c.valor)));
  const totalDeposits = toNumber(sumDecimal(deposits.map(d => d.valor)));

  return (
    <div className="p-6 space-y-4">
      {/* Status banner */}
      <div className={`rounded-xl p-4 flex items-center gap-3 ${
        isFechado ? 'bg-emerald-50 border border-emerald-200' :
        allPassed ? 'bg-blue-50 border border-blue-200' :
        'bg-amber-50 border border-amber-200'
      }`}>
        {isFechado ? (
          <CheckCircle className="w-6 h-6 text-emerald-600" />
        ) : allPassed ? (
          <CheckCircle className="w-6 h-6 text-blue-600" />
        ) : (
          <AlertTriangle className="w-6 h-6 text-amber-600" />
        )}
        <div className="flex-1">
          <p className="text-sm font-bold text-slate-800">
            {isFechado ? 'BT Fechado' : allPassed ? 'Pronto para fechamento' : `Pendências detectadas (${pendingItems.length})`}
          </p>
          <p className="text-xs text-slate-600 mt-0.5">
            {isFechado
              ? `BT ${currentBt.numero} foi fechado em ${formatDate(currentBt.data)}. Você pode reabrir para editar.`
              : allPassed
                ? 'Todas as validações passaram. Você pode validar e fechar o BT.'
                : 'Resolva as pendências abaixo antes de fechar o BT.'
            }
          </p>
        </div>
        {isFechado && (
          <Button variant="secondary" onClick={handleReopen}>
            <Unlock className="w-4 h-4" /> Reabrir para Edição
          </Button>
        )}
      </div>

      {/* Lista detalhada de pendências com atalhos */}
      {!isFechado && pendingItems.length > 0 && (
        <Card className="p-5 border-amber-200">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Onde estão as pendências</h3>
          <ul className="space-y-2">
            {pendingItems.map((item, i) => (
              <li key={i} className="flex items-start gap-3 py-2 border-b border-slate-50 last:border-0">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-700">[{item.location}]</p>
                  <p className="text-xs text-slate-500">{item.message}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => onNavigate?.(item.goTo)} className="!py-1 !px-2 !text-[11px] flex-shrink-0">
                  {item.goToLabel} <ArrowRight className="w-3 h-3" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Signatures blocked indicator */}
      {isFechado && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-lg text-sm font-medium">
          <Lock className="w-4 h-4" />
          BT Fechado — todos os campos, tabelas e ações estão bloqueados em todas as abas.
        </div>
      )}

      {/* Validation checks */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-800">Validações de Fechamento</h3>
          <Button size="sm" variant="ghost" onClick={handleRecalculate} disabled={recalculating}>
            {recalculating ? 'Recalculando...' : 'Recalcular Saldos em Cascata'}
          </Button>
        </div>
        <div className="space-y-2">
          {checks.map((check, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
              {check.passed ? (
                <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-700">{check.label}</p>
                <p className="text-xs text-slate-500">{check.detail}</p>
              </div>
              <Badge color={check.passed ? 'green' : 'amber'}>
                {check.passed ? 'OK' : 'Pendente'}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* Summary grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-xs text-slate-500">Total Entradas</p>
          <p className="text-base font-bold text-emerald-700">{formatCurrency(totalEntradas)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Total Saídas</p>
          <p className="text-base font-bold text-amber-700">{formatCurrency(totalSaidas)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Cheques a Compensar</p>
          <p className="text-base font-bold text-slate-700">{formatCurrency(totalChequesCompensar)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Depósitos Pendentes</p>
          <p className="text-base font-bold text-slate-700">{formatCurrency(totalDeposits)}</p>
        </Card>
      </div>

      {/* Signatures */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-800">Assinaturas</h3>
          {btAnterior && !isFechado && (
            <Button size="sm" variant="secondary" onClick={handleImportSignatures}>
              <UserCheck className="w-4 h-4" /> Importar do BT Anterior
            </Button>
          )}
        </div>
        {btAnterior && (
          <p className="text-xs text-slate-500 mb-3">
            Assinaturas do BT anterior ({btAnterior.numero}): {btAnterior.elaborado_por || '—'}{btAnterior.cargo_elaborado ? ` (${btAnterior.cargo_elaborado})` : ''} · {btAnterior.conferido_por || '—'}{btAnterior.cargo_conferido ? ` (${btAnterior.cargo_conferido})` : ''}. Os campos permanecem editáveis.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Elaborado por</p>
            <Field label="Nome">
              <Input value={elaboradoPor} onChange={(e) => setElaboradoPor(e.target.value)} placeholder="Nome do responsável" disabled={isFechado} />
            </Field>
            <Field label="Cargo">
              <Input value={cargoElaborado} onChange={(e) => setCargoElaborado(e.target.value)} placeholder="Ex: Tesoureiro" disabled={isFechado} />
            </Field>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Conferido por</p>
            <Field label="Nome">
              <Input value={conferidoPor} onChange={(e) => setConferidoPor(e.target.value)} placeholder="Nome do responsável" disabled={isFechado} />
            </Field>
            <Field label="Cargo">
              <Input value={cargoConferido} onChange={(e) => setCargoConferido(e.target.value)} placeholder="Ex: Diretor" disabled={isFechado} />
            </Field>
          </div>
        </div>
        {!isFechado && (
          <div className="flex justify-end mt-4">
            <Button variant="secondary" onClick={handleSaveSignatures}>
              <Save className="w-4 h-4" /> Salvar Assinaturas
            </Button>
          </div>
        )}
      </Card>

      {/* Actions */}
      {!isFechado && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleValidate} disabled={!allPassed}>
            Validar BT
          </Button>
          <Button onClick={handleClose} disabled={!allPassed || closing} className="bg-emerald-600 hover:bg-emerald-700">
            <Lock className="w-4 h-4" /> {closing ? 'Fechando...' : 'Fechar BT'}
          </Button>
        </div>
      )}
    </div>
  );
}
