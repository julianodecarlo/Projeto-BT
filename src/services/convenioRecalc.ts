import { supabase } from '@/lib/supabase';
import { toDecimal } from '@/lib/format';
import type { Convenio, FonteOrcamentaria, Transaction } from '@/types';

/*
 * Recálculo IDEMPOTENTE das fontes orçamentárias de um convênio no BT ativo.
 *
 * Fórmula (por fonte):
 *   Saldo Fonte = Saldo Anterior da Fonte (snapshot do BT)
 *               + Depósitos EXCLUSIVAMENTE desta fonte
 *               - Anulações/Estornos EXCLUSIVAMENTE desta fonte
 *
 * Fontes de verdade:
 *   - Saldo Anterior: tabela bt_convenios (snapshot gravado na transposição do BT)
 *   - Lançamentos: transactions WHERE tipo = 'deposito_anulacao'
 *     AND account_id = conta financeira do convênio
 *     AND fonte_orcamentaria = <fonte exata>  (nenhum cruzamento entre colunas)
 *
 * O resultado sobrescreve o campo da fonte em convenios — salvar várias vezes,
 * editar ou excluir lançamentos sempre reconstrói o mesmo estado.
 */

const FONTES: FonteOrcamentaria[] = ['fonte_5', 'fonte_45', 'fonte_4', 'fonte_44'];

export async function getSaldoAnteriorFontes(btId: string, convenioId: string): Promise<Record<FonteOrcamentaria, number> | null> {
  const { data } = await supabase
    .from('bt_convenios')
    .select('fonte_5, fonte_45, fonte_4, fonte_44')
    .eq('bt_report_id', btId)
    .eq('convenio_id', convenioId)
    .maybeSingle();
  if (!data) return null;
  return data as Record<FonteOrcamentaria, number>;
}

// Saldo de UMA fonte = snapshot + depósitos - anulações, filtrando pelo ID do
// convênio (via conta financeira) E pela fonte exata do lançamento.
export function calcSaldoFonte(
  saldoAnterior: number,
  lancamentos: Transaction[],
  convenioAccIds: Set<string>,
  fonte: FonteOrcamentaria
): number {
  let saldo = toDecimal(saldoAnterior);
  for (const tx of lancamentos) {
    // Filtro estrito: conta pertence ao convênio E fonte_orcamentaria é EXATAMENTE a fonte
    if (!convenioAccIds.has(tx.account_id)) continue;
    if (tx.fonte_orcamentaria !== fonte) continue;
    // Depósitos e anulações chegam como 'entrada' (anulação é estorno que credita
    // a conta, mas DESCONTA da fonte orçamentária)
    saldo = saldo.plus(tx.valor);
  }
  return saldo.toNumber();
}

// Recalcula as 4 fontes de um convênio e persiste em convenios.
export async function recalcConvenioFontes(
  btId: string,
  convenio: Convenio,
  lancamentos: Transaction[]
): Promise<boolean> {
  const accIds = new Set<string>(convenio.finance_account_id ? [convenio.finance_account_id] : []);
  if (accIds.size === 0) return false;

  const snapshot = await getSaldoAnteriorFontes(btId, convenio.id);
  // Sem snapshot do BT (convênio criado depois da transposição): usa o valor
  // cadastrado atual como saldo anterior.
  const base: Record<FonteOrcamentaria, number> = snapshot ?? {
    fonte_5: convenio.fonte_5,
    fonte_45: convenio.fonte_45,
    fonte_4: convenio.fonte_4,
    fonte_44: convenio.fonte_44,
  };

  const novo: Record<FonteOrcamentaria, number> = {
    fonte_5: calcSaldoFonte(base.fonte_5, lancamentos, accIds, 'fonte_5'),
    fonte_45: calcSaldoFonte(base.fonte_45, lancamentos, accIds, 'fonte_45'),
    fonte_4: calcSaldoFonte(base.fonte_4, lancamentos, accIds, 'fonte_4'),
    fonte_44: calcSaldoFonte(base.fonte_44, lancamentos, accIds, 'fonte_44'),
  };

  const { error } = await supabase.from('convenios').update(novo).eq('id', convenio.id);
  if (error) {
    console.error('Erro ao recalcular fontes do convênio:', error.message || error);
    return false;
  }
  return true;
}

// Recalcula todos os convênios vinculados às contas tocadas pelos lançamentos.
// Persiste no banco; o chamador recarrega a lista de convênios depois.
export async function recalcConveniosPorContas(
  btId: string,
  convenios: Convenio[],
  contasTocadas: Iterable<string>
): Promise<void> {
  const tocadas = new Set(contasTocadas);
  if (tocadas.size === 0) return;

  const afetados = convenios.filter(c => c.finance_account_id && tocadas.has(c.finance_account_id));
  if (afetados.length === 0) return;

  const { data } = await supabase
    .from('transactions')
    .select('*')
    .eq('bt_report_id', btId)
    .eq('tipo', 'deposito_anulacao');
  const lancamentos = (data as Transaction[]) || [];

  for (const conv of afetados) {
    await recalcConvenioFontes(btId, conv, lancamentos);
  }
}

export { FONTES };
