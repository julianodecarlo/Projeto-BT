import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Trash2, CheckCircle, AlertTriangle, FileText, Handshake, Check, Search, CreditCard, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import { Card, Button, Input, Field, Select, Badge, EmptyState } from '@/components/ui/Field';
import { formatCurrency, formatDate, toDecimal, toNumber, sumDecimal } from '@/lib/format';
import type { Cheque, DepositPending, Reconciliation, Transaction, Account, Convenio, PaymentPending, PendencyResolution, BtReport } from '@/types';

type ResolutionKind = 'cheque' | 'deposito' | 'pagamento';

interface MoneyInputProps {
  value: number | null;
  onValueChange: (value: number) => void;
  className?: string;
  placeholder?: string;
}

const formatDigits = (digits: string): string => {
  if (!digits) return '';
  const cents = parseInt(digits, 10);
  const intPart = Math.floor(cents / 100).toString();
  const decPart = (cents % 100).toString().padStart(2, '0');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intFormatted},${decPart}`;
};

function MoneyInput({ value, onValueChange, className, placeholder }: MoneyInputProps) {
  const [display, setDisplay] = useState(() =>
    value != null && value !== 0 ? formatDigits(Math.round(value * 100).toString()) : ''
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDisplay(value != null && value !== 0 ? formatDigits(Math.round(value * 100).toString()) : '');
    }
  }, [value, focused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '') || '';
    setDisplay(formatDigits(digits));
    const cents = digits ? parseInt(digits, 10) : 0;
    onValueChange(cents / 100);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={handleChange}
      className={className}
      placeholder={placeholder}
    />
  );
}

export default function Conciliacao() {
  const { currentBt, accounts } = useBt();
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
    const [chequesRes, depositsRes, paymentsRes, resolutionsRes, reconRes, txRes, convRes, btsRes] = await Promise.all([
      supabase.from('cheques').select('*').order('data_emissao', { ascending: true }),
      supabase.from('deposits_pending').select('*').order('created_at', { ascending: true }),
      supabase.from('payments_pending').select('*').order('created_at', { ascending: true }),
      supabase.from('pendency_resolutions').select('*'),
      supabase.from('reconciliation').select('*').eq('bt_report_id', currentBt.id),
      supabase.from('transactions').select('*').eq('bt_report_id', currentBt.id).order('ordem', { ascending: true }),
      supabase.from('convenios').select('*'),
      supabase.from('bt_reports').select('id, data, status'),
    ]);
    if (chequesRes.data) setCheques(chequesRes.data as Cheque[]);
    if (depositsRes.data) setDeposits(depositsRes.data as DepositPending[]);
    if (paymentsRes.data) setPayments(paymentsRes.data as PaymentPending[]);
    if (resolutionsRes.data) setResolutions(resolutionsRes.data as PendencyResolution[]);
    if (reconRes.data) setReconciliations(reconRes.data as Reconciliation[]);
    if (txRes.data) setTransactions(txRes.data as Transaction[]);
    if (convRes.data) setConvenios(convRes.data as Convenio[]);
    if (btsRes.data) setAllBts(btsRes.data as BtReport[]);
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
  const getAccountSaldoOrcamentario = (accId: string): number => {
    const acc = getAccount(accId);
    if (!acc) return 0;
    const accTxs = transactions.filter(t => t.account_id === accId);
    if (accTxs.length === 0) return acc.saldo_inicial;
    return accTxs[accTxs.length - 1].saldo_final;
  };

  // Pendências abertas = criadas em qualquer BT, sem baixa no BT atual.
  // A baixa é dada apenas no BT em que é clicada; BTs anteriores permanecem inalterados.
  const openItems = useMemo(() => {
    if (!currentBt) return { cheques: [] as Cheque[], deposits: [] as DepositPending[], payments: [] as PaymentPending[] };
    const resolvedInCurrent = new Set(
      resolutions.filter(r => r.bt_report_id === currentBt.id).map(r => `${r.kind}:${r.ref_id}`)
    );
    const filter = <T extends { id: string }>(rows: T[], kind: ResolutionKind): T[] =>
      rows.filter(row => !resolvedInCurrent.has(`${kind}:${row.id}`));
    return {
      cheques: filter(cheques, 'cheque'),
      deposits: filter(deposits, 'deposito'),
      payments: filter(payments, 'pagamento'),
    };
  }, [currentBt, resolutions, cheques, deposits, payments]);

  const resolve = async (kind: ResolutionKind, refId: string) => {
    if (!currentBt) return;
    const { error } = await supabase
      .from('pendency_resolutions')
      .insert({ kind, ref_id: refId, bt_report_id: currentBt.id });
    if (!error) {
      setResolutions([...resolutions, { kind, ref_id: refId, bt_report_id: currentBt.id, id: crypto.randomUUID(), created_at: new Date().toISOString() }]);
    }
  };

  // Pendências por conta: (+ cheques a compensar + pagamentos pendentes - depósitos pendentes)
  const pendenciasPorConta = useMemo(() => {
    const map = new Map<string, number>();
    const add = (accId: string, v: number) => map.set(accId, (map.get(accId) || 0) + v);
    for (const c of openItems.cheques) add(c.account_id, c.valor);
    for (const p of openItems.payments) add(p.account_id, p.valor);
    for (const d of openItems.deposits) add(d.account_id, -d.valor);
    return map;
  }, [openItems]);

  const getPendencias = (accId: string) => pendenciasPorConta.get(accId) ?? 0;

  // Cheques handlers
  const addCheque = async () => {
    if (!currentBt || !chequeAccountId || !chequeNumero.trim() || !chequeValor || !chequeBenef.trim()) return;
    const { data, error } = await supabase
      .from('cheques')
      .insert({
        bt_report_id: currentBt.id,
        account_id: chequeAccountId,
        data_emissao: currentBt.data,
        numero: chequeNumero.trim(),
        valor: toDecimal(chequeValor).toNumber(),
        beneficiario: chequeBenef.trim(),
        status: 'a_compensar',
      })
      .select()
      .single();
    if (!error && data) {
      setCheques([...cheques, data as Cheque]);
      setChequeNumero(''); setChequeValor(''); setChequeBenef('');
      setShowChequeForm(false);
    }
  };

  const deleteCheque = async (id: string) => {
    await supabase.from('cheques').delete().eq('id', id);
    setCheques(cheques.filter(c => c.id !== id));
  };

  // Deposit handlers
  const addDeposit = async () => {
    if (!currentBt || !depositAccountId || !depositValor) return;
    const { data, error } = await supabase
      .from('deposits_pending')
      .insert({
        bt_report_id: currentBt.id,
        account_id: depositAccountId,
        valor: toDecimal(depositValor).toNumber(),
        descricao: depositDesc.trim() || null,
      })
      .select()
      .single();
    if (!error && data) {
      setDeposits([...deposits, data as DepositPending]);
      setDepositValor(''); setDepositDesc('');
      setShowDepositForm(false);
    }
  };

  const deleteDeposit = async (id: string) => {
    await supabase.from('deposits_pending').delete().eq('id', id);
    setDeposits(deposits.filter(d => d.id !== id));
  };

  // Payment pending handlers
  const addPayment = async () => {
    if (!currentBt || !paymentAccountId || !paymentValor) return;
    const { data, error } = await supabase
      .from('payments_pending')
      .insert({
        bt_report_id: currentBt.id,
        account_id: paymentAccountId,
        valor: toDecimal(paymentValor).toNumber(),
        data_lancamento: paymentData || currentBt.data,
        descricao: paymentDesc.trim() || null,
      })
      .select()
      .single();
    if (!error && data) {
      setPayments([...payments, data as PaymentPending]);
      setPaymentValor(''); setPaymentDesc('');
      setShowPaymentForm(false);
    }
  };

  const deletePayment = async (id: string) => {
    await supabase.from('payments_pending').delete().eq('id', id);
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
    const saldoConciliado = toDecimal(saldoExtrato).plus(toDecimal(rendimento)).toNumber();
    const divergente = Math.abs(toDecimal(saldoConciliado).minus(toDecimal(saldoOrcamentario)).minus(toDecimal(pendencias)).toNumber()) > 0.01;

    if (existing) {
      const { data, error } = await supabase
        .from('reconciliation')
        .update({
          saldo_extrato: saldoExtrato,
          rendimento_acumulado: rendimento,
          saldo_conciliado: saldoConciliado,
          saldo_orcamentario: saldoOrcamentario,
          divergente,
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (!error && data) {
        setReconciliations(reconciliations.map(r => r.id === existing.id ? data as Reconciliation : r));
      }
    } else {
      const { data, error } = await supabase
        .from('reconciliation')
        .insert({
          bt_report_id: currentBt.id,
          account_id: accId,
          saldo_extrato: saldoExtrato,
          rendimento_acumulado: rendimento,
          saldo_conciliado: saldoConciliado,
          saldo_orcamentario: saldoOrcamentario,
          divergente,
        })
        .select()
        .single();
      if (!error && data) {
        setReconciliations([...reconciliations, data as Reconciliation]);
      }
    }
  };

  if (!currentBt) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Nenhum BT ativo" description="Crie um novo Boletim de Tesouraria para realizar a conciliação bancária." />
      </div>
    );
  }

  const activeAccounts = accounts.filter(a => a.ativo);
  const totalChequesCompensar = toNumber(sumDecimal(openItems.cheques.map(c => c.valor)));
  const totalDeposits = toNumber(sumDecimal(openItems.deposits.map(d => d.valor)));
  const totalPayments = toNumber(sumDecimal(openItems.payments.map(p => p.valor)));
  const divergentCount = reconciliations.filter(r => r.divergente).length;
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
                <button onClick={() => deleteCheque(cq.id)} className="text-slate-400 hover:text-red-500">
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
    <div className="p-6 space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
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
              <p className="text-xs text-slate-500">Depósitos Pendentes</p>
              <p className="text-base font-bold text-blue-700">{formatCurrency(totalDeposits)}</p>
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
          <p className="text-xs text-slate-500 mt-0.5">Pendências = + Cheques + Pagamentos - Depósitos · Conciliado quando Extrato + Rendimentos = Orçamentário + Pendências</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Conta</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Orçamentário</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Extrato</th>
                <th className="px-4 py-2 text-right font-semibold">Rendimentos Acum.</th>
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
                // Lado bancário (extrato + rendimentos) confrontado com o lado contábil (orçamentário + pendências)
                const saldoConc = toDecimal(saldoExtrato ?? 0).plus(toDecimal(rendimento)).toNumber();
                const extratoVazio = saldoExtrato === null || saldoExtrato === 0;
                const divergente = !extratoVazio && Math.abs(toDecimal(saldoConc).minus(toDecimal(saldoOrc)).minus(toDecimal(pend)).toNumber()) > 0.01;
                return (
                  <tr key={acc.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-700">{acc.nome}</p>
                      <p className="text-xs text-slate-400">{acc.codigo}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-600">{formatCurrency(saldoOrc)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <MoneyInput
                        value={saldoExtrato}
                        onValueChange={(v) => updateRecon(acc.id, 'saldo_extrato', v)}
                        className="w-32 text-right py-1.5"
                        placeholder="0,00"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <MoneyInput
                        value={recon?.rendimento_acumulado ?? 0}
                        onValueChange={(v) => updateRecon(acc.id, 'rendimento_acumulado', v)}
                        className="w-28 text-right py-1.5"
                        placeholder="0,00"
                      />
                    </td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${pend < 0 ? 'text-blue-700' : pend > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                      {formatCurrency(pend)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-700">{formatCurrency(saldoConc)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {extratoVazio ? (
                        <Badge color="slate">Pendente</Badge>
                      ) : divergente ? (
                        <Badge color="red">Divergente</Badge>
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
                <Input type="number" step="0.01" value={chequeValor} onChange={(e) => setChequeValor(e.target.value)} placeholder="0,00" />
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
          <div className="p-3 space-y-3 max-h-96 overflow-y-auto">
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
                <Input type="number" step="0.01" value={depositValor} onChange={(e) => setDepositValor(e.target.value)} placeholder="0,00" />
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
          <div className="p-3 space-y-3 max-h-96 overflow-y-auto">
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
                            <button onClick={() => deleteDeposit(dp.id)} className="text-slate-400 hover:text-red-500">
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
            <Field label="Valor a Pagar (R$)">
              <Input type="number" step="0.01" value={paymentValor} onChange={(e) => setPaymentValor(e.target.value)} placeholder="0,00" />
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
        <div className="p-3 space-y-3 max-h-96 overflow-y-auto">
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
                          <button onClick={() => deletePayment(p.id)} className="text-slate-400 hover:text-red-500">
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

      {/* Pendências resolvidas no BT atual */}
      {resolutions.filter(r => r.bt_report_id === currentBt.id).length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-bold text-slate-800">Baixas dadas neste BT</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {resolutions
              .filter(r => r.bt_report_id === currentBt.id)
              .map(r => {
                const label =
                  r.kind === 'cheque'
                    ? `Cheque #${cheques.find(c => c.id === r.ref_id)?.numero ?? '—'} compensado`
                    : r.kind === 'deposito'
                      ? `Depósito "${deposits.find(d => d.id === r.ref_id)?.descricao || 'sem descrição'}" concluído`
                      : `Pagamento "${payments.find(p => p.id === r.ref_id)?.descricao || 'sem descrição'}" concluído`;
                return (
                  <span key={r.id} className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-1 text-xs">
                    <CheckCircle className="w-3.5 h-3.5" /> {label}
                  </span>
                );
              })}
          </div>
        </Card>
      )}

      <p className="text-xs text-slate-400 px-1 flex items-center gap-1.5">
        <Search className="w-3.5 h-3.5" />
        As baixas (Cheque Compensado, Concluído, Concluir Pagamento) valem apenas para o BT atual e não alteram saldos contábeis ou orçamentários.
      </p>
    </div>
  );
}
