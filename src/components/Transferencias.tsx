import { useEffect, useState } from 'react';
import { ArrowRight, Banknote, Landmark, Shuffle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBt } from '@/context/BtContext';
import { Card, Button, Field, Select, Input, Badge } from '@/components/ui/Field';
import { formatCurrency, toDecimal } from '@/lib/format';
import type { Account, TransactionTipo } from '@/types';

const TESOURO_KEYWORDS = ['tesouro'];

const isTesouro = (acc: Account) =>
  TESOURO_KEYWORDS.some(k => acc.nome.toLowerCase().includes(k));

const findTesouro = (accounts: Account[]) => accounts.find(isTesouro);

const findCategoria = (accounts: Account[], cat: Account['categoria']) =>
  accounts.find(a => a.categoria === cat);

// Determina de/para com inversão automática quando o valor é negativo.
const resolveTransfer = (from: Account, to: Account, valor: number) => {
  if (valor >= 0) return { from, to, efetivo: valor };
  return { from: to, to: from, efetivo: Math.abs(valor) };
};

function TransferRow({ valor, from, to, label }: { valor: number; from: Account; to: Account; label: string }) {
  const { efetivo, from: f, to: t } = resolveTransfer(from, to, valor || 0);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <span className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-red-700">− {f.nome}</span>
        <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
        <span className="font-semibold text-emerald-700">+ {t.nome}</span>
        <Badge color="blue">{formatCurrency(efetivo)}</Badge>
      </span>
    </div>
  );
}

export default function Transferencias() {
  const { currentBt, accounts } = useBt();
  const [repasseValor, setRepasseValor] = useState('');
  const [trReceitaValor, setTrReceitaValor] = useState('');
  const [trDiariasValor, setTrDiariasValor] = useState('');
  const [livreOrigem, setLivreOrigem] = useState('');
  const [livreDestino, setLivreDestino] = useState('');
  const [livreValor, setLivreValor] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeAccounts = accounts.filter(a => a.ativo);
  const tesouro = findTesouro(activeAccounts);
  const receita = findCategoria(activeAccounts, 'receita');
  const diarias = findCategoria(activeAccounts, 'diarias');

  useEffect(() => {
    if (activeAccounts.length > 0 && !livreOrigem) setLivreOrigem(activeAccounts[0].id);
    if (activeAccounts.length > 1 && !livreDestino) setLivreDestino(activeAccounts[1].id);
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  };

  const insertTransfer = async (
    tipo: TransactionTipo,
    fromId: string,
    toId: string,
    valor: number,
    descricao: string
  ): Promise<boolean> => {
    if (!currentBt || !fromId || !toId || valor <= 0) return false;
    const { data: saldoAnteriorRes } = await supabase
      .from('transactions')
      .select('saldo_final')
      .eq('bt_report_id', currentBt.id)
      .eq('account_id', fromId)
      .order('ordem', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: saldoDestinoRes } = await supabase
      .from('transactions')
      .select('saldo_final')
      .eq('bt_report_id', currentBt.id)
      .eq('account_id', toId)
      .order('ordem', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: accFrom } = await supabase.from('accounts').select('saldo_inicial').eq('id', fromId).maybeSingle();
    const { data: accTo } = await supabase.from('accounts').select('saldo_inicial').eq('id', toId).maybeSingle();
    const saldoAnteriorFrom = saldoAnteriorRes?.saldo_final ?? accFrom?.saldo_inicial ?? 0;
    const saldoAnteriorTo = saldoDestinoRes?.saldo_final ?? accTo?.saldo_inicial ?? 0;

    const { error: errFrom } = await supabase.from('transactions').insert({
      bt_report_id: currentBt.id,
      account_id: fromId,
      descricao,
      tipo_movimento: 'saida',
      valor,
      saldo_anterior: saldoAnteriorFrom,
      saldo_final: toDecimal(saldoAnteriorFrom).minus(toDecimal(valor)).toNumber(),
      data_lancamento: currentBt.data,
      tipo,
    });
    const { error: errTo } = await supabase.from('transactions').insert({
      bt_report_id: currentBt.id,
      account_id: toId,
      descricao,
      tipo_movimento: 'entrada',
      valor,
      saldo_anterior: saldoAnteriorTo,
      saldo_final: toDecimal(saldoAnteriorTo).plus(toDecimal(valor)).toNumber(),
      data_lancamento: currentBt.data,
      tipo,
    });
    if (errFrom || errTo) {
      setError('Não foi possível registrar a transferência. Tente novamente.');
      return false;
    }
    return true;
  };

  const handleSaveRepasse = async () => {
    if (!tesouro || !repasseValor || parseFloat(repasseValor) <= 0) return;
    setSaving('repasse');
    setError(null);
    // Repasse: apenas credita a Conta Tesouro (uma transação de entrada).
    const { data: lastTx } = await supabase
      .from('transactions')
      .select('saldo_final')
      .eq('bt_report_id', currentBt!.id)
      .eq('account_id', tesouro.id)
      .order('ordem', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: accData } = await supabase.from('accounts').select('saldo_inicial').eq('id', tesouro.id).maybeSingle();
    const saldoAnterior = lastTx?.saldo_final ?? accData?.saldo_inicial ?? 0;
    const valor = toDecimal(repasseValor).toNumber();
    const { error: err } = await supabase.from('transactions').insert({
      bt_report_id: currentBt!.id,
      account_id: tesouro.id,
      descricao: 'Repasse Financeiro da Reitoria',
      tipo_movimento: 'entrada',
      valor,
      saldo_anterior: saldoAnterior,
      saldo_final: toDecimal(saldoAnterior).plus(toDecimal(valor)).toNumber(),
      data_lancamento: currentBt!.data,
      tipo: 'repasse_reitoria',
    });
    setSaving(null);
    if (err) {
      setError('Não foi possível registrar o repasse. Tente novamente.');
      return;
    }
    setRepasseValor('');
    showFlash('Repasse registrado e somado ao saldo da Conta Tesouro.');
  };

  const handleSaveReceita = async () => {
    if (!tesouro || !receita || !trReceitaValor || parseFloat(trReceitaValor) === 0) return;
    setSaving('receita');
    setError(null);
    const { from, to, efetivo } = resolveTransfer(tesouro, receita, parseFloat(trReceitaValor));
    const ok = await insertTransfer('transf_tesouro_receita', from.id, to.id, efetivo, 'Transferência Tesouro → Receita');
    setSaving(null);
    if (ok) {
      setTrReceitaValor('');
      showFlash('Transferência Tesouro → Receita registrada.');
    }
  };

  const handleSaveDiarias = async () => {
    if (!tesouro || !diarias || !trDiariasValor || parseFloat(trDiariasValor) === 0) return;
    setSaving('diarias');
    setError(null);
    const { from, to, efetivo } = resolveTransfer(tesouro, diarias, parseFloat(trDiariasValor));
    const ok = await insertTransfer('transf_tesouro_diarias', from.id, to.id, efetivo, 'Transferência Tesouro → Diárias');
    setSaving(null);
    if (ok) {
      setTrDiariasValor('');
      showFlash('Transferência Tesouro → Diárias registrada.');
    }
  };

  const handleSaveLivre = async () => {
    if (!livreOrigem || !livreDestino || !livreValor || parseFloat(livreValor) === 0) return;
    if (livreOrigem === livreDestino) {
      setError('A conta origem e a conta destino devem ser diferentes.');
      return;
    }
    setSaving('livre');
    setError(null);
    const origem = activeAccounts.find(a => a.id === livreOrigem)!;
    const destino = activeAccounts.find(a => a.id === livreDestino)!;
    const { from, to, efetivo } = resolveTransfer(origem, destino, parseFloat(livreValor));
    const ok = await insertTransfer('transf_livre', from.id, to.id, efetivo, `Transferência ${origem.nome} → ${destino.nome}`);
    setSaving(null);
    if (ok) {
      setLivreValor('');
      showFlash('Transferência registrada no histórico do BT.');
    }
  };

  const fromAcc = activeAccounts.find(a => a.id === livreOrigem);
  const toAcc = activeAccounts.find(a => a.id === livreDestino);

  return (
    <div className="space-y-4">
      {flash && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 font-medium">
          <Banknote className="w-4 h-4" /> {flash}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 font-medium">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* A) Repasse Financeiro da Reitoria */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <Landmark className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800">Repasse Financeiro da Reitoria</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">O valor informado é somado diretamente ao saldo da Conta Tesouro.</p>
          <Field label="Valor do repasse (R$)">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={repasseValor}
              onChange={(e) => setRepasseValor(e.target.value)}
              placeholder="0,00"
            />
          </Field>
          {tesouro && (
            <p className="text-xs text-slate-500 mt-2">
              Conta: <span className="font-semibold text-slate-700">{tesouro.nome}</span>
            </p>
          )}
          <div className="flex justify-end mt-4">
            <Button size="sm" onClick={handleSaveRepasse} disabled={saving === 'repasse' || !repasseValor || parseFloat(repasseValor) <= 0}>
              {saving === 'repasse' ? 'Registrando...' : 'Registrar'}
            </Button>
          </div>
        </Card>

        {/* B) Transferências Específicas */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <ArrowRight className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">Transferências Específicas</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">Valores negativos invertem o movimento automaticamente.</p>
          <div className="space-y-3">
            <Field label="Tesouro → Receita (R$)">
              <Input
                type="number"
                step="0.01"
                value={trReceitaValor}
                onChange={(e) => setTrReceitaValor(e.target.value)}
                placeholder="0,00"
              />
            </Field>
            <TransferRow valor={parseFloat(trReceitaValor) || 0} from={tesouro!} to={receita!} label="Movimento" />
            <div className="flex justify-end">
              <Button size="sm" onClick={handleSaveReceita} disabled={saving === 'receita' || !trReceitaValor || parseFloat(trReceitaValor) === 0}>
                {saving === 'receita' ? 'Registrando...' : 'Registrar'}
              </Button>
            </div>
            <Field label="Tesouro → Diárias (R$)">
              <Input
                type="number"
                step="0.01"
                value={trDiariasValor}
                onChange={(e) => setTrDiariasValor(e.target.value)}
                placeholder="0,00"
              />
            </Field>
            {tesouro && diarias && (
              <TransferRow valor={parseFloat(trDiariasValor) || 0} from={tesouro} to={diarias} label="Movimento" />
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={handleSaveDiarias} disabled={saving === 'diarias' || !trDiariasValor || parseFloat(trDiariasValor) === 0}>
                {saving === 'diarias' ? 'Registrando...' : 'Registrar'}
              </Button>
            </div>
          </div>
        </Card>

        {/* C) Transferência Livre entre Contas */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <Shuffle className="w-4 h-4 text-slate-600" />
            <h3 className="text-sm font-bold text-slate-800">Transferência Livre entre Contas</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">Escolha a origem e o destino. Valores negativos invertem a operação.</p>
          <div className="space-y-3">
            <Field label="Conta Origem">
              <Select value={livreOrigem} onChange={(e) => setLivreOrigem(e.target.value)}>
                {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </Select>
            </Field>
            <Field label="Conta Destino">
              <Select value={livreDestino} onChange={(e) => setLivreDestino(e.target.value)}>
                {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </Select>
            </Field>
            <Field label="Valor (R$)">
              <Input
                type="number"
                step="0.01"
                value={livreValor}
                onChange={(e) => setLivreValor(e.target.value)}
                placeholder="0,00"
              />
            </Field>
            {fromAcc && toAcc && fromAcc.id !== toAcc.id && (
              <TransferRow valor={parseFloat(livreValor) || 0} from={fromAcc} to={toAcc} label="Movimento" />
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={handleSaveLivre} disabled={saving === 'livre' || !livreValor || parseFloat(livreValor) === 0}>
                {saving === 'livre' ? 'Registrando...' : 'Registrar'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
