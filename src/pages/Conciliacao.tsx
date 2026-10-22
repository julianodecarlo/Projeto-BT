import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Trash2, CheckCircle, AlertTriangle, FileText, Handshake, Check, Receipt } from 'lucide-react';
import { useBt } from '@/context/BtContext';
import { Card, Button, Input, Field, Select, Badge, EmptyState } from '@/components/ui/Field';
import { MoneyInput } from '@/components/ui/MoneyInput';
import {
  fetchPendencyData,
  listBtMeta,
  listConvenios,
  fetchReconciliations,
  saveReconciliation,
  resolvePendency,
  addCheque as svcAddCheque,
  deleteCheque as svcDeleteCheque,
  addDeposit as svcAddDeposit,
  deleteDeposit as svcDeleteDeposit,
  addPayment as svcAddPayment,
  deletePayment as svcDeletePayment,
} from '@/services/reconciliationService';
import { listTransactions } from '@/services/transactionService';
import { formatCurrency, formatDate, toDecimal, toNumber, sumDecimal } from '@/lib/format';
import type { Cheque, DepositPending, Reconciliation, Transaction, Account, Convenio, PaymentPending, PendencyResolution, BtReport } from '@/types';
import { getOpenItems } from '@/lib/reconStatus';
import { sortAccounts } from '@/lib/sortAccounts';

type ResolutionKind = 'cheque' | 'deposito' | 'pagamento';

import { BtFechadoGuard, BtFechadoBanner } from '@/components/BtFechadoGuard';

export default function Conciliacao() {
  const { currentBt, accounts, refreshReconciliations } = useBt();
  const fechado = currentBt?.status === 'fechado';
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [deposits, setDeposits] = useState<DepositPending[]>([]);
  const [payments, setPayments] = useState<PaymentPending[]>([]);
  const [resolutions, setResolutions] = useState<PendencyResolution[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [convenios, setConvenios] = useState<Convenio[]>([]);
  const [allBts, setAllBts] = useState<BtReport[]>([]);

  // Form state - cheques
  const [showChequeForm, setShowChequeForm] = useState(false);
  const [chequeAccountId, setChequeAccountId] = useState('');
  const [chequeNumero, setChequeNumero] = useState('');
  const [chequeValor, setChequeValor] = useState('');
  const [chequeBenef, setChequeBenef] = useState('');

  // Form state - deposits
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [depositAccountId, setDepositAccountId] = useState('');
  const [depositValor, setDepositValor] = useState('');
  const [depositDesc, setDepositDesc] = useState('');

  // Form state - payments pending
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [paymentValor, setPaymentValor] = useState('');
  const [paymentData, setPaymentData] = useState('');
  const [paymentDesc, setPaymentDesc] = useState('');

  const fetchAll = useCallback(async () => {
    if (!currentBt) return;
    const [pendency, recons, txs, conveniosData, btsMeta] = await Promise.all([
      fetchPendencyData(),
      fetchReconciliations(currentBt.id),
      listTransactions(currentBt.id),
      listConvenios(),
      listBtMeta(),
    ]);
    setCheques(pendency.cheques);
    setDeposits(pendency.deposits);
    setPayments(pendency.payments);
    setResolutions(pendency.resolutions);
    setReconciliations(recons);
    setTransactions(txs);
    setConvenios(conveniosData);
    setAllBts(btsMeta as BtReport[]);
  }, [currentBt]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (accounts.length > 0 && !chequeAccountId) setChequeAccountId(accounts[0].id);
    if (accounts.length > 0 && !depositAccountId) setDepositAccountId(accounts[0].id);
    if (accounts.length > 0 && !paymentAccountId) setPaymentAccountId(accounts[0].id);
  }, [accounts, chequeAccountId, depositAccountId, paymentAccountId]);

  useEffect(() => {
    if (currentBt && !paymentData) setPaymentData(currentBt.data);
  }, [currentBt, paymentData]);

  const getAccount = (id: string) => accounts.find(a => a.id === id);
  // Saldo Orçamentário = MESMA fórmula do Saldo Final da aba Movimentações,
  // independente de ordem das linhas: âncora "Saldo Anterior" + entradas − saídas.
  const getAccountSaldoOrcamentario = (accId: string): number => {
    const acc = getAccount(accId);
    if (!acc) return 0;
    const accTxs = transactions.filter(t => t.account_id === accId);
    if (accTxs.length === 0) return acc.saldo_inicial;
    const anchor = accTxs.find(t => t.descricao === 'Saldo Anterior');
    let saldo = toDecimal(anchor ? (anchor.saldo_anterior || 0) : acc.saldo_inicial || 0);
    for (const t of accTxs) {
      if (t.descricao === 'Saldo Anterior') continue;
      const v = toDecimal(t.valor || 0);
      saldo = t.tipo_movimento === 'entrada' ? saldo.plus(v) : saldo.minus(v);
    }
    return saldo.toNumber();
  };

  // FOTO ESTÁTICA POR BT: usa a fonte única (reconStatus) — entram pendências
  // criadas até este BT e não baixadas em/antes dele. Baixas dadas em BTs
  // futuros não alteram a foto deste BT.
  const openItems = useMemo(() => {
    if (!currentBt) return { cheques: [] as Cheque[], deposits: [] as DepositPending[], payments: [] as PaymentPending[] };
    return getOpenItems(
      { cheques, deposits, payments, resolutions },
      { id: currentBt.id, data: currentBt.data },
      allBts
    );
  }, [currentBt, cheques, deposits, payments, resolutions, allBts]);

  const resolve = async (kind: ResolutionKind, refId: string) => {
    if (!currentBt) return;
    // A baixa fica registrada no BT corrente (foto estática deste período).
    // O status permanente do registro original só é atualizado para auditoria;
    // fotos de BTs anteriores permanecem intactas.
    const created = await resolvePendency(kind, refId, currentBt.id);
    if (!created) return;
    setResolutions([...resolutions, created]);
  };

  // Pendências por conta: (+ cheques a compensar + pagamentos pendentes - depósitos pendentes)
  const pendenciasPorConta = useMemo(() => {
    const map = new Map<string, number>();
    const add = (accId: string, v: number) => map.set(accId, (map.get(accId) || 0) + v);
    for (const c of openItems.cheques) add(c.account_id, c.valor);
    for (const p of openItems.payments) add(p.account_id, p.valor);
    for (const d of openItems.deposits) add(d.account_id, d.valor);
    return map;
  }, [openItems]);

  const getPendencias = (accId: string) => pendenciasPorConta.get(accId) ?? 0;

  // Tolerância zero: 1 centavo é divergência. Compara em centavos inteiros para eliminar ruído de ponto flutuante.
  const isConciliado = (a: number, b: number): boolean =>
    Math.round(a * 100) === Math.round(b * 100);
  const toCentavos = (v: number): number => Math.round(v * 100) / 100;

  const handleNav = (e: React.KeyboardEvent<HTMLInputElement>, nextCell: string | null) => {
    if (e.key !== 'Tab' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!nextCell) return;
    requestAnimationFrame(() => {
      const td = document.querySelector<HTMLTableCellElement>(`[data-recon-cell="${nextCell}"]`);
      const input = td?.querySelector<HTMLInputElement>('input');
      if (input) { input.focus(); input.select(); }
    });
  };

  // Cheques handlers
  const addCheque = async () => {
    if (!currentBt || !chequeAccountId || !chequeNumero.trim() || !chequeValor || !chequeBenef.trim()) return;
    const created = await svcAddCheque({
      bt_report_id: currentBt.id,
      account_id: chequeAccountId,
      data_emissao: currentBt.data,
      numero: chequeNumero.trim(),
      valor: toDecimal(chequeValor).toNumber(),
      beneficiario: chequeBenef.trim(),
      status: 'a_compensar',
    });
    if (created) {
      setCheques([...cheques, created]);
      setChequeNumero(''); setChequeValor(''); setChequeBenef('');
      setShowChequeForm(false);
    }
  };

  const removeCheque = async (id: string) => {
    await svcDeleteCheque(id);
    setCheques(cheques.filter(c => c.id !== id));
  };

  // Deposit handlers
  const addDeposit = async () => {
    if (!currentBt || !depositAccountId || !depositValor) return;
    const created = await svcAddDeposit({
      bt_report_id: currentBt.id,
      account_id: depositAccountId,
      valor: toDecimal(depositValor).toNumber(),
      descricao: depositDesc.trim() || null,
    });
    if (created) {
      setDeposits([...deposits, created]);
      setDepositValor(''); setDepositDesc('');
      setShowDepositForm(false);
    }
  };

  const removeDeposit = async (id: string) => {
    await svcDeleteDeposit(id);
    setDeposits(deposits.filter(d => d.id !== id));
  };

  // Payment pending handlers
  const addPayment = async () => {
    if (!currentBt || !paymentAccountId || !paymentValor) return;
    const created = await svcAddPayment({
      bt_report_id: currentBt.id,
      account_id: paymentAccountId,
      valor: toDecimal(paymentValor).toNumber(),
      data_lancamento: paymentData || currentBt.data,
      descricao: paymentDesc.trim() || null,
    });
    if (created) {
      setPayments([...payments, created]);
      setPaymentValor(''); setPaymentDesc('');
      setShowPaymentForm(false);
    }
  };

  const removePayment = async (id: string) => {
    await svcDeletePayment(id);
    setPayments(payments.filter(p => p.id !== id));
  };

  // Reconciliation handlers
  const getRecon = (accId: string): Reconciliation | undefined =>
    reconciliations.find(r => r.account_id === accId);

  const updateRecon = async (accId: string, field: string, value: number) => {
    if (!currentBt) return;
    const existing = getRecon(accId);
    const saldoOrcamentario = getAccountSaldoOrcamentario(accId);
    const pendencias = getPendencias(accId);
    const rendimento = field === 'rendimento_acumulado' ? value : (existing?.rendimento_acumulado ?? 0);
    const saldoExtrato = field === 'saldo_extrato' ? value : (existing?.saldo_extrato ?? 0);
    const ajuste = field === 'ajuste_arredondamento' ? value : (existing?.ajuste_arredondamento ?? 0);
    const saldoConciliado = toCentavos(toDecimal(toCentavos(saldoExtrato)).minus(toDecimal(rendimento)).minus(toDecimal(ajuste)).minus(toDecimal(pendencias)).toNumber());
    const divergente = !isConciliado(saldoConciliado, saldoOrcamentario);

    const saved = await saveReconciliation({
      id: existing?.id,
      btReportId: currentBt.id,
      accountId: accId,
      saldo_extrato: saldoExtrato,
      rendimento_acumulado: rendimento,
      ajuste_arredondamento: ajuste,
      saldo_conciliado: saldoConciliado,
      saldo_orcamentario: saldoOrcamentario,
      divergente,
    });
    if (saved) {
      setReconciliations(
        existing
          ? reconciliations.map(r => (r.id === existing.id ? saved : r))
          : [...reconciliations, saved]
      );
      await refreshReconciliations();
    }
  };

  if (!currentBt) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Nenhum BT ativo" description="Crie um novo Boletim de Tesouraria para realizar a conciliação bancária." />
      </div>
    );
  }

  const activeAccounts = sortAccounts(accounts.filter(a => a.ativo));
  const totalChequesCompensar = toNumber(sumDecimal(openItems.cheques.map(c => c.valor)));
  const totalDeposits = toNumber(sumDecimal(openItems.deposits.map(d => d.valor)));
  const totalPayments = toNumber(sumDecimal(openItems.payments.map(p => p.valor)));
  const divergentCount = activeAccounts.filter(acc => {
    const recon = getRecon(acc.id);
    const saldoExtrato = recon?.saldo_extrato ?? null;
    if (saldoExtrato === null || saldoExtrato === 0) return false;
    const rendimento = recon?.rendimento_acumulado ?? 0;
    const ajuste = recon?.ajuste_arredondamento ?? 0;
    const saldoConc = toCentavos(toDecimal(toCentavos(saldoExtrato)).minus(toDecimal(rendimento)).minus(toDecimal(ajuste)).minus(toDecimal(getPendencias(acc.id))).toNumber());
    return !isConciliado(saldoConc, getAccountSaldoOrcamentario(acc.id));
  }).length;
  const totalConveniosPorConta = new Map<string, number>();
  for (const c of convenios) {
    if (!c.finance_account_id) continue;
    const t = toDecimal(c.fonte_5 || 0).plus(toDecimal(c.fonte_45 || 0)).plus(toDecimal(c.fonte_4 || 0)).plus(toDecimal(c.fonte_44 || 0)).toNumber();
    totalConveniosPorConta.set(c.finance_account_id, (totalConveniosPorConta.get(c.finance_account_id) || 0) + t);
  }
  const btNumeroById = (id: string | null) => {
    const bt = allBts.find(b => b.id === id);
    return bt ? `BT ${bt.data ? formatDate(bt.data) : ''}` : '—';
  };

  const groupsFor = <T extends { account_id: string; valor: number }>(
    rows: T[]
  ): { acc: Account; rows: T[]; total: number }[] =>
    activeAccounts
      .map(acc => {
        const accRows = rows.filter(r => r.account_id === acc.id);
        return { acc, rows: accRows, total: toNumber(sumDecimal(accRows.map(r => r.valor))) };
      })
      .filter(g => g.rows.length > 0);

  const chequeGroups = groupsFor(openItems.cheques);
  const depositGroups = groupsFor(openItems.deposits);
  const paymentGroups = groupsFor(openItems.payments);

  const ChequeGroupCard = ({ g }: { g: { acc: Account; rows: Cheque[]; total: number } }) => (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700">{g.acc.nome}</span>
        <span className="text-xs font-semibold text-amber-700">{formatCurrency(g.total)}</span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {g.rows.map(cq => (
            <tr key={cq.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 group">
              <td className="px-3 py-2">
                <p className="font-medium text-slate-700">Cheque nº {cq.numero} - {cq.beneficiario}</p>
                <p className="text-[10px] text-slate-400">Lançamento: {formatDate(cq.data_emissao)} · emitido em {btNumeroById(cq.bt_report_id)}</p>
              </td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700">{formatCurrency(cq.valor)}</td>
              <td className="px-2 py-2">
                <Button size="sm" variant="secondary" onClick={() => resolve('cheque', cq.id)} className="!py-1 !px-2 !text-[11px]">
                  <Check className="w-3 h-3" /> Cheque Compensado
                </Button>
              </td>
              <td className="px-2 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => removeCheque(cq.id)} className="text-slate-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
    {fechado && <div className="px-6 pt-4"><BtFechadoBanner numero={currentBt?.numero ?? ''} /></div>}
    <BtFechadoGuard fechado={fechado}>
    <div className="p-6 space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
              <Receipt className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Cheques a Compensar</p>
              <p className="text-base font-bold text-amber-700">{formatCurrency(totalChequesCompensar)}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Depósitos / Pagamentos Pendentes</p>
              <p className="text-base font-bold text-blue-700">{formatCurrency(totalDeposits + totalPayments)}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${divergentCount > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
              {divergentCount > 0 ? <AlertTriangle className="w-5 h-5 text-red-600" /> : <CheckCircle className="w-5 h-5 text-emerald-600" />}
            </div>
            <div>
              <p className="text-xs text-slate-500">Divergências</p>
              <p className={`text-base font-bold ${divergentCount > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{divergentCount}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Espelho dos Convênios por conta financeira */}
      {totalConveniosPorConta.size > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Handshake className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">Total Geral dos Convênios (espelho para validação)</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {Array.from(totalConveniosPorConta.entries()).map(([accId, total]) => (
              <div key={accId} className="flex items-center justify-between bg-blue-50/50 border border-blue-100 rounded-lg px-3 py-2">
                <span className="text-xs font-medium text-slate-600">{accounts.find(a => a.id === accId)?.nome || 'Conta removida'}</span>
                <span className="text-sm font-bold text-blue-700">{formatCurrency(total)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Reconciliation table per account */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-800">Conciliação por Conta</h3>
          <p className="text-xs text-slate-500 mt-0.5">Conciliado quando Extrato − Rendimentos − Dif.Arred.Rend − Pendências = Saldo Orçamentário</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Conta</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Orçamentário</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Extrato</th>
                <th className="px-4 py-2 text-right font-semibold">Rendimentos Acum.</th>
                <th className="px-2 py-2 text-center font-semibold" title="Compensação de arredondamento de rendimentos">Dif.Arred.Rend</th>
                <th className="px-4 py-2 text-right font-semibold">Pendências</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Conciliado</th>
                <th className="px-4 py-2 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {activeAccounts.map(acc => {
                const recon = getRecon(acc.id);
                const saldoOrc = getAccountSaldoOrcamentario(acc.id);
                const pend = getPendencias(acc.id);
                const saldoExtrato = recon?.saldo_extrato ?? null;
                const rendimento = recon?.rendimento_acumulado ?? 0;
                const ajuste = recon?.ajuste_arredondamento ?? 0;
                // Lado bancário (extrato - rendimentos - ajuste - pendências) confrontado com o orçamentário
                const saldoConc = toCentavos(toDecimal(toCentavos(saldoExtrato ?? 0)).minus(toDecimal(rendimento)).minus(toDecimal(ajuste)).minus(toDecimal(pend)).toNumber());
                const extratoVazio = saldoExtrato === null || saldoExtrato === 0;
                const divergente = !extratoVazio && !isConciliado(saldoConc, saldoOrc);
                return (
                  <tr key={acc.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-700">{acc.nome}</p>
                      <p className="text-xs text-slate-400">{acc.codigo}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-600">{formatCurrency(saldoOrc)}</td>
                    <td data-recon-cell={`extrato:${acc.id}`} className="px-4 py-2.5 text-right">
                      <MoneyInput
                        value={saldoExtrato}
                        onValueChange={(v) => updateRecon(acc.id, 'saldo_extrato', v)}
                        onKeyDown={(e) => handleNav(e, `rendimento:${acc.id}`)}
                        className="w-32 pr-3"
                        placeholder="0,00"
                      />
                    </td>
                    <td data-recon-cell={`rendimento:${acc.id}`} className="px-4 py-2.5 text-right">
                      <MoneyInput
                        value={recon?.rendimento_acumulado ?? 0}
                        onValueChange={(v) => updateRecon(acc.id, 'rendimento_acumulado', v)}
                        onKeyDown={(e) => handleNav(e, `ajuste:${acc.id}`)}
                        className="w-28 pr-3"
                        placeholder="0,00"
                      />
                    </td>
                    <td data-recon-cell={`ajuste:${acc.id}`} className="px-2 py-2.5 text-center">
                      <div className="inline-flex items-center rounded-lg border border-slate-200 overflow-hidden">
                        <button
                          onClick={() => updateRecon(acc.id, 'ajuste_arredondamento', ajuste === -0.01 ? 0 : -0.01)}
                          disabled={fechado || extratoVazio}
                          className={`px-2 py-1 text-[11px] font-bold transition-colors disabled:opacity-30 ${
                            ajuste === -0.01 ? 'bg-amber-100 text-amber-800' : 'bg-white text-slate-400 hover:bg-slate-50'
                          }`}
                          title="Rendimento truncado pelo BB: reduz 1 centavo"
                        >
                          -0,01
                        </button>
                        <button
                          onClick={() => updateRecon(acc.id, 'ajuste_arredondamento', ajuste === 0.01 ? 0 : 0.01)}
                          disabled={fechado || extratoVazio}
                          className={`px-2 py-1 text-[11px] font-bold border-l border-slate-200 transition-colors disabled:opacity-30 ${
                            ajuste === 0.01 ? 'bg-amber-100 text-amber-800' : 'bg-white text-slate-400 hover:bg-slate-50'
                          }`}
                          title="Rendimento truncado pelo BB: soma 1 centavo"
                        >
                          +0,01
                        </button>
                      </div>
                    </td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${pend < 0 ? 'text-red-700' : pend > 0 ? 'text-blue-700' : 'text-slate-400'}`}>
                      {formatCurrency(pend)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-700">{formatCurrency(saldoConc)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {extratoVazio ? (
                        <Badge color="slate">Pendente</Badge>
                      ) : divergente ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <Badge color="red">Divergente</Badge>
                          <span className="text-[11px] font-semibold text-red-700">
                            Dif: {formatCurrency(toCentavos(toDecimal(saldoConc).minus(toDecimal(saldoOrc)).toNumber()))}
                          </span>
                        </div>
                      ) : (
                        <Badge color="green">Conciliado</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pendências: linha 1 = cheques (largura total) · linha 2 = depósitos + pagamentos lado a lado */}
      {/* Cheques (largura total) */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Cheques a Compensar</h3>
              <p className="text-xs text-slate-500 mt-0.5">Histórico mantido entre BTs · agrupados por conta corrente</p>
            </div>
            <Button size="sm" onClick={() => setShowChequeForm(!showChequeForm)}>
              <Plus className="w-3.5 h-3.5" /> Cheque
            </Button>
          </div>
          {showChequeForm && (
            <div className="p-3 bg-blue-50/30 border-b border-slate-100 grid grid-cols-2 gap-2">
              <Field label="Conta" className="col-span-2">
                <Select value={chequeAccountId} onChange={(e) => setChequeAccountId(e.target.value)}>
                  {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
                </Select>
              </Field>
              <Field label="Número">
                <Input value={chequeNumero} onChange={(e) => setChequeNumero(e.target.value)} placeholder="000123" />
              </Field>
              <Field label="Valor (R$)">
                <MoneyInput value={Number(chequeValor) || null} onValueChange={(v) => setChequeValor(v ? String(v) : '')} />
              </Field>
              <Field label="Beneficiário" className="col-span-2">
                <Input value={chequeBenef} onChange={(e) => setChequeBenef(e.target.value)} placeholder="Nome do beneficiário" />
              </Field>
              <div className="col-span-2 flex justify-end gap-2 mt-1">
                <Button size="sm" variant="secondary" onClick={() => setShowChequeForm(false)}>Cancelar</Button>
                <Button size="sm" onClick={addCheque}>Adicionar</Button>
              </div>
            </div>
          )}
          <div className="p-3 space-y-3">
            {chequeGroups.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Nenhum cheque a compensar</p>
            ) : (
              chequeGroups.map(g => <ChequeGroupCard key={g.acc.id} g={g} />)
            )}
          </div>
        </Card>

      {/* Linha 2: depósitos (esquerda) + pagamentos (direita) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* Depósitos */}
      <Card className="overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Depósitos Pendentes</h3>
              <p className="text-xs text-slate-500 mt-0.5">Histórico mantido entre BTs · agrupados por conta corrente</p>
            </div>
            <Button size="sm" onClick={() => setShowDepositForm(!showDepositForm)}>
              <Plus className="w-3.5 h-3.5" /> Depósito
            </Button>
          </div>
          {showDepositForm && (
            <div className="p-3 bg-blue-50/30 border-b border-slate-100 grid grid-cols-2 gap-2">
              <Field label="Conta" className="col-span-2">
                <Select value={depositAccountId} onChange={(e) => setDepositAccountId(e.target.value)}>
                  {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
                </Select>
              </Field>
              <Field label="Valor (R$)">
                <MoneyInput value={Number(depositValor) || null} onValueChange={(v) => setDepositValor(v ? String(v) : '')} />
              </Field>
              <Field label="Descrição">
                <Input value={depositDesc} onChange={(e) => setDepositDesc(e.target.value)} placeholder="Origem do depósito" />
              </Field>
              <div className="col-span-2 flex justify-end gap-2 mt-1">
                <Button size="sm" variant="secondary" onClick={() => setShowDepositForm(false)}>Cancelar</Button>
                <Button size="sm" onClick={addDeposit}>Adicionar</Button>
              </div>
            </div>
          )}
          <div className="p-3 space-y-3">
            {depositGroups.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Nenhum depósito pendente</p>
            ) : (
              depositGroups.map(g => (
                <div key={g.acc.id} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">{g.acc.nome}</span>
                    <span className="text-xs font-semibold text-blue-700">{formatCurrency(g.total)}</span>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {g.rows.map(dp => (
                        <tr key={dp.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 group">
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-700">{dp.descricao || 'Sem descrição'}</p>
                            <p className="text-[10px] text-slate-400">registrado em {btNumeroById(dp.bt_report_id)}</p>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-700">{formatCurrency(dp.valor)}</td>
                          <td className="px-2 py-2">
                            <Button size="sm" variant="secondary" onClick={() => resolve('deposito', dp.id)} className="!py-1 !px-2 !text-[11px]">
                              <Check className="w-3 h-3" /> Concluído
                            </Button>
                          </td>
                          <td className="px-2 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => removeDeposit(dp.id)} className="text-slate-400 hover:text-red-500">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
      </Card>

      {/* Pagamentos Pendentes */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Pagamentos Pendentes</h3>
            <p className="text-xs text-slate-500 mt-0.5">Histórico mantido entre BTs · agrupados por conta corrente a debitar</p>
          </div>
          <Button size="sm" onClick={() => setShowPaymentForm(!showPaymentForm)}>
            <Plus className="w-3.5 h-3.5" /> Pagamento
          </Button>
        </div>
        {showPaymentForm && (
          <div className="p-3 bg-blue-50/30 border-b border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-2">
            <Field label="Conta a Debitar">
              <Select value={paymentAccountId} onChange={(e) => setPaymentAccountId(e.target.value)}>
                {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </Select>
            </Field>
            <Field label="Valor (+ ou -)">
              <MoneyInput value={Number(paymentValor) || null} onValueChange={(v) => setPaymentValor(v ? String(v) : '')} />
            </Field>
            <Field label="Data do Lançamento">
              <Input type="date" value={paymentData} onChange={(e) => setPaymentData(e.target.value)} />
            </Field>
            <Field label="Descrição / Histórico">
              <Input value={paymentDesc} onChange={(e) => setPaymentDesc(e.target.value)} placeholder="Histórico do pagamento" />
            </Field>
            <div className="col-span-2 md:col-span-4 flex justify-end gap-2 mt-1">
              <Button size="sm" variant="secondary" onClick={() => setShowPaymentForm(false)}>Cancelar</Button>
              <Button size="sm" onClick={addPayment}>Adicionar</Button>
            </div>
          </div>
        )}
        <div className="p-3 space-y-3">
          {paymentGroups.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">Nenhum pagamento pendente</p>
          ) : (
            paymentGroups.map(g => (
              <div key={g.acc.id} className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">{g.acc.nome}</span>
                  <span className="text-xs font-semibold text-red-700">{formatCurrency(g.total)}</span>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {g.rows.map(p => (
                      <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 group">
                        <td className="px-3 py-2">
                          <p className="font-medium text-slate-700">{p.descricao || 'Sem descrição'}</p>
                          <p className="text-[10px] text-slate-400">
                            {formatDate(p.data_lancamento)} · registrado em {btNumeroById(p.bt_report_id)}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-700">{formatCurrency(p.valor)}</td>
                        <td className="px-2 py-2">
                          <Button size="sm" variant="secondary" onClick={() => resolve('pagamento', p.id)} className="!py-1 !px-2 !text-[11px]">
                            <Check className="w-3 h-3" /> Concluir Pagamento
                          </Button>
                        </td>
                        <td className="px-2 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => removePayment(p.id)} className="text-slate-400 hover:text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      </Card>
      </div>

      <p className="text-xs text-slate-400 px-1">
        As baixas (Cheque Compensado, Concluído, Concluir Pagamento) valem apenas para o BT atual e não alteram saldos contábeis ou orçamentários.
      </p>
    </div>
    </BtFechadoGuard>
    </>
  );
}
