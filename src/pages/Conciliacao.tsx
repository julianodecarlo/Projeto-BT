import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, CheckCircle, AlertTriangle, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import { Card, Button, Input, Field, Select, Badge, EmptyState } from '@/components/ui/Field';
import { formatCurrency, formatDate, toDecimal, toNumber, sumDecimal } from '@/lib/format';
import type { Cheque, DepositPending, Reconciliation, Transaction, Account } from '@/types';

export default function Conciliacao() {
  const { currentBt, accounts } = useBt();
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [deposits, setDeposits] = useState<DepositPending[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

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

  const fetchAll = useCallback(async () => {
    if (!currentBt) return;
    const [chequesRes, depositsRes, reconRes, txRes] = await Promise.all([
      supabase.from('cheques').select('*').eq('bt_report_id', currentBt.id).order('data_emissao', { ascending: true }),
      supabase.from('deposits_pending').select('*').eq('bt_report_id', currentBt.id).order('created_at', { ascending: true }),
      supabase.from('reconciliation').select('*').eq('bt_report_id', currentBt.id),
      supabase.from('transactions').select('*').eq('bt_report_id', currentBt.id).order('ordem', { ascending: true }),
    ]);
    if (chequesRes.data) setCheques(chequesRes.data as Cheque[]);
    if (depositsRes.data) setDeposits(depositsRes.data as DepositPending[]);
    if (reconRes.data) setReconciliations(reconRes.data as Reconciliation[]);
    if (txRes.data) setTransactions(txRes.data as Transaction[]);
  }, [currentBt]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (accounts.length > 0 && !chequeAccountId) setChequeAccountId(accounts[0].id);
    if (accounts.length > 0 && !depositAccountId) setDepositAccountId(accounts[0].id);
  }, [accounts, chequeAccountId, depositAccountId]);

  const getAccount = (id: string) => accounts.find(a => a.id === id);
  const getAccountSaldoOrcamentario = (accId: string): number => {
    const acc = getAccount(accId);
    if (!acc) return 0;
    const accTxs = transactions.filter(t => t.account_id === accId);
    if (accTxs.length === 0) return acc.saldo_inicial;
    return accTxs[accTxs.length - 1].saldo_final;
  };

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

  const toggleChequeStatus = async (id: string) => {
    const cq = cheques.find(c => c.id === id);
    if (!cq) return;
    const newStatus = cq.status === 'a_compensar' ? 'compensado' : 'a_compensar';
    await supabase.from('cheques').update({ status: newStatus }).eq('id', id);
    setCheques(cheques.map(c => c.id === id ? { ...c, status: newStatus } : c));
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

  // Reconciliation handlers
  const getRecon = (accId: string): Reconciliation | undefined =>
    reconciliations.find(r => r.account_id === accId);

  const updateRecon = async (accId: string, field: string, value: number) => {
    if (!currentBt) return;
    const existing = getRecon(accId);
    const saldoOrcamentario = getAccountSaldoOrcamentario(accId);
    const rendimento = field === 'rendimento_acumulado' ? value : (existing?.rendimento_acumulado ?? 0);
    const saldoExtrato = field === 'saldo_extrato' ? value : (existing?.saldo_extrato ?? 0);
    const saldoConciliado = toDecimal(saldoExtrato).plus(toDecimal(rendimento)).toNumber();
    const divergente = Math.abs(saldoConciliado - saldoOrcamentario) > 0.01;

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
  const totalChequesCompensar = toNumber(sumDecimal(cheques.filter(c => c.status === 'a_compensar').map(c => c.valor)));
  const totalDeposits = toNumber(sumDecimal(deposits.map(d => d.valor)));
  const divergentCount = reconciliations.filter(r => r.divergente).length;

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

      {/* Reconciliation table per account */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-800">Conciliação por Conta</h3>
          <p className="text-xs text-slate-500 mt-0.5">Informe o saldo do extrato bancário e os rendimentos acumulados</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Conta</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Orçamentário</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Extrato</th>
                <th className="px-4 py-2 text-right font-semibold">Rendimentos Acum.</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo Conciliado</th>
                <th className="px-4 py-2 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {activeAccounts.map(acc => {
                const recon = getRecon(acc.id);
                const saldoOrc = getAccountSaldoOrcamentario(acc.id);
                const saldoExtrato = recon?.saldo_extrato ?? 0;
                const rendimento = recon?.rendimento_acumulado ?? 0;
                const saldoConc = recon?.saldo_conciliado ?? 0;
                const divergente = recon?.divergente ?? false;
                return (
                  <tr key={acc.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-700">{acc.nome}</p>
                      <p className="text-xs text-slate-400">{acc.codigo}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-600">{formatCurrency(saldoOrc)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Input
                        type="number"
                        step="0.01"
                        value={saldoExtrato || ''}
                        onChange={(e) => updateRecon(acc.id, 'saldo_extrato', toDecimal(e.target.value || 0).toNumber())}
                        className="w-32 text-right py-1.5"
                        placeholder="0,00"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Input
                        type="number"
                        step="0.01"
                        value={rendimento || ''}
                        onChange={(e) => updateRecon(acc.id, 'rendimento_acumulado', toDecimal(e.target.value || 0).toNumber())}
                        className="w-28 text-right py-1.5"
                        placeholder="0,00"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-700">{formatCurrency(saldoConc)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {saldoExtrato === 0 && rendimento === 0 ? (
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

      {/* Cheques and Deposits side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cheques */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Cheques Emitidos</h3>
              <p className="text-xs text-slate-500 mt-0.5">A compensar e compensados</p>
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
          <div className="max-h-72 overflow-y-auto">
            {cheques.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">Nenhum cheque registrado</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {cheques.map(cq => (
                    <tr key={cq.id} className="border-b border-slate-50 hover:bg-slate-50 group">
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-700">Cheque #{cq.numero}</p>
                        <p className="text-[10px] text-slate-400">{cq.beneficiario} · {formatDate(cq.data_emissao)}</p>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{formatCurrency(cq.valor)}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => toggleChequeStatus(cq.id)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                            cq.status === 'compensado'
                              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                              : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                          }`}
                        >
                          {cq.status === 'compensado' ? 'Compensado' : 'A Compensar'}
                        </button>
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
            )}
          </div>
        </Card>

        {/* Deposits */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Depósitos Pendentes</h3>
              <p className="text-xs text-slate-500 mt-0.5">Depósitos não identificados</p>
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
          <div className="max-h-72 overflow-y-auto">
            {deposits.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">Nenhum depósito pendente</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {deposits.map(dp => (
                    <tr key={dp.id} className="border-b border-slate-50 hover:bg-slate-50 group">
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-700">{getAccount(dp.account_id)?.nome || '—'}</p>
                        <p className="text-[10px] text-slate-400">{dp.descricao || 'Sem descrição'}</p>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{formatCurrency(dp.valor)}</td>
                      <td className="px-2 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => deleteDeposit(dp.id)} className="text-slate-400 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
