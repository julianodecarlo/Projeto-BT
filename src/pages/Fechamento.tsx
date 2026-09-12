import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, AlertTriangle, FileText, Lock, Save, Unlock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import { Card, Button, Input, Field, Badge, EmptyState } from '@/components/ui/Field';
import { formatCurrency, toDecimal, toNumber, sumDecimal, formatDate } from '@/lib/format';
import type { Transaction, Reconciliation, RevenueOwn, Cheque, DepositPending } from '@/types';

interface ValidationCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export default function Fechamento() {
  const { currentBt, accounts, refreshBt, cascadeRecalculate } = useBt();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [revenues, setRevenues] = useState<RevenueOwn[]>([]);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [deposits, setDeposits] = useState<DepositPending[]>([]);
  const [elaboradoPor, setElaboradoPor] = useState('');
  const [cargoElaborado, setCargoElaborado] = useState('');
  const [conferidoPor, setConferidoPor] = useState('');
  const [cargoConferido, setCargoConferido] = useState('');
  const [closing, setClosing] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!currentBt) return;
    const [txRes, reconRes, revRes, cqRes, dpRes] = await Promise.all([
      supabase.from('transactions').select('*').eq('bt_report_id', currentBt.id),
      supabase.from('reconciliation').select('*').eq('bt_report_id', currentBt.id),
      supabase.from('revenue_own').select('*').eq('bt_report_id', currentBt.id),
      supabase.from('cheques').select('*').eq('bt_report_id', currentBt.id),
      supabase.from('deposits_pending').select('*').eq('bt_report_id', currentBt.id),
    ]);
    if (txRes.data) setTransactions(txRes.data as Transaction[]);
    if (reconRes.data) setReconciliations(reconRes.data as Reconciliation[]);
    if (revRes.data) setRevenues(revRes.data as RevenueOwn[]);
    if (cqRes.data) setCheques(cqRes.data as Cheque[]);
    if (dpRes.data) setDeposits(dpRes.data as DepositPending[]);
    setElaboradoPor(currentBt.elaborado_por || '');
    setCargoElaborado(currentBt.cargo_elaborado || '');
    setConferidoPor(currentBt.conferido_por || '');
    setCargoConferido(currentBt.cargo_conferido || '');
  }, [currentBt]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

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

  const divergentRecon = reconciliations.filter(r => r.divergente);
  checks.push({
    label: 'Conciliação bancária sem divergências',
    passed: divergentRecon.length === 0,
    detail: divergentRecon.length === 0
      ? `${reconciliations.length} conta(s) conciliada(s)`
      : `${divergentRecon.length} conta(s) com divergência`,
  });

  const accountsWithTx = new Set(transactions.map(t => t.account_id));
  const accountsWithoutRecon = accounts.filter(a => a.ativo && accountsWithTx.has(a.id) && !reconciliations.find(r => r.account_id === a.id));
  checks.push({
    label: 'Todas as contas com movimento conciliadas',
    passed: accountsWithoutRecon.length === 0,
    detail: accountsWithoutRecon.length === 0
      ? 'Todas as contas ativas com movimento foram conciliadas'
      : `${accountsWithoutRecon.length} conta(s) sem conciliação`,
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

  const handleSaveSignatures = async () => {
    if (!currentBt) return;
    await supabase
      .from('bt_reports')
      .update({
        elaborado_por: elaboradoPor.trim() || null,
        cargo_elaborado: cargoElaborado.trim() || null,
        conferido_por: conferidoPor.trim() || null,
        cargo_conferido: cargoConferido.trim() || null,
      })
      .eq('id', currentBt.id);
    await refreshBt();
  };

  const handleClose = async () => {
    if (!currentBt || !allPassed) return;
    setClosing(true);
    await supabase
      .from('bt_reports')
      .update({ status: 'fechado' })
      .eq('id', currentBt.id);
    await refreshBt();
    await fetchAll();
    setClosing(false);
  };

  const handleValidate = async () => {
    if (!currentBt) return;
    await supabase
      .from('bt_reports')
      .update({ status: 'validado' })
      .eq('id', currentBt.id);
    await refreshBt();
  };

  const handleReopen = async () => {
    if (!currentBt) return;
    await supabase
      .from('bt_reports')
      .update({ status: 'rascunho' })
      .eq('id', currentBt.id);
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
            {isFechado ? 'BT Fechado' : allPassed ? 'Pronto para fechamento' : 'Pendências detectadas'}
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
        <h3 className="text-sm font-bold text-slate-800 mb-3">Assinaturas</h3>
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
