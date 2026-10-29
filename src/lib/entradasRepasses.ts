import Decimal from 'decimal.js';
import type {
  Account,
  BtReport,
  BudgetType,
  Transaction,
} from '@/types';

/*
 * Cálculo informativo "Entradas e Repasses": confere o total de pagamentos
 * (Manta Geral) e as anulações do mês (acumulado até o BT atual) contra os
 * valores informados pelo orçamentário/financeiro. Não altera saldos.
 */

export type Origem = 'tesouro' | 'convenio' | 'receita' | 'nao_classificada';

export interface EntradasRepassesRow {
  inf_total_pagamentos: number;
  inf_rp_tesouro: number;
  inf_rp_convenio: number;
  inf_rp_receita: number;
  inf_dc_tesouro: number;
  inf_dc_convenio: number;
  inf_dc_receita: number;
  inf_anulacoes: number;
  contabeis_novo_vigente: number;
  contabeis_novo_restos: number;
  contabeis_novo_diversos: number;
  ajuste_total_pagamentos: number;
  ajuste_anulacoes: number;
  observacao: string | null;
}

export type SavedEntradasRepasses = Partial<EntradasRepassesRow> & { bt_report_id?: string };

export interface SistemaSide {
  pagamentosVigenteBanco: number;
  contabeisAnterior: Record<BudgetType, number>;
  contabeisTotal: Record<BudgetType, number>;
  mantaGeral: number;
  restosPorOrigem: Record<'tesouro' | 'convenio' | 'receita', number>;
  diversosPorOrigem: Record<'tesouro' | 'convenio' | 'receita', number>;
  anulacoes: number;
  anulacoesCompetenciaAnterior: number;
  mantaLiquido: number;
  avisoLegadoConvenio: boolean;
  contasNaoClassificadas: string[];
}

export interface PeriodoInfo {
  btIds: string[];
  primeiroNumero: string | null;
  ultimoNumero: string | null;
  mesAno: string;
}

const d = (n: number | Decimal | null | undefined): Decimal => new Decimal(n ?? 0);
const num = (x: Decimal): number => x.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

// Período: BTs do mesmo ano-mês do atual com data <= atual (empate: created_at
// <= o do atual), ordenados por data, created_at.
export function periodoDoMes(
  atual: Pick<BtReport, 'id' | 'data' | 'created_at'>,
  bts: Pick<BtReport, 'id' | 'data' | 'created_at' | 'numero'>[]
): Pick<BtReport, 'id' | 'data' | 'created_at' | 'numero'>[] {
  const mesAtual = atual.data.slice(0, 7);
  return bts
    .filter(b => b.data.slice(0, 7) === mesAtual)
    .filter(b => {
      if (b.data < atual.data) return true;
      if (b.data > atual.data) return false;
      return b.created_at <= atual.created_at;
    })
    .sort((a, b) => (a.data === b.data ? a.created_at.localeCompare(b.created_at) : a.data.localeCompare(b.data)));
}

export function descricaoPeriodo(
  atual: Pick<BtReport, 'id' | 'data' | 'created_at' | 'numero'>,
  bts: Pick<BtReport, 'id' | 'data' | 'created_at' | 'numero'>[]
): PeriodoInfo {
  const doMes = periodoDoMes(atual, bts);
  const [ano, mes] = atual.data.split('-');
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return {
    btIds: doMes.map(b => b.id),
    primeiroNumero: doMes[0]?.numero ?? null,
    ultimoNumero: doMes[doMes.length - 1]?.numero ?? null,
    mesAno: `${meses[Number(mes) - 1]}/${ano}`,
  };
}

// Origem de uma conta para os pagamentos por origem.
export function origemDaConta(acc: Pick<Account, 'categoria' | 'nome'> | undefined): Origem {
  if (!acc) return 'nao_classificada';
  switch (acc.categoria) {
    case 'convenio': return 'convenio';
    case 'receita': return 'receita';
    case 'movimento':
    case 'diarias': return 'tesouro';
    default: return 'nao_classificada';
  }
}

export function calcularSistema(
  atual: Pick<BtReport, 'id' | 'data' | 'created_at'>,
  bts: Pick<BtReport, 'id' | 'data' | 'created_at' | 'numero'>[],
  transacoes: Pick<Transaction, 'bt_report_id' | 'account_id' | 'tipo' | 'tipo_movimento' | 'tipo_orcamento' | 'natureza' | 'fonte_orcamentaria' | 'valor' | 'competencia_anterior'>[],
  contas: Pick<Account, 'id' | 'categoria' | 'nome'>[],
  linhasSalvas: Pick<SavedEntradasRepasses, 'bt_report_id' | 'contabeis_novo_vigente' | 'contabeis_novo_restos' | 'contabeis_novo_diversos' | 'ajuste_total_pagamentos' | 'ajuste_anulacoes'>[],
  btIdsPeriodo?: string[]
): SistemaSide {
  const doMes = btIdsPeriodo ? bts.filter(b => btIdsPeriodo.includes(b.id)) : periodoDoMes(atual, bts);
  const idsPeriodo = new Set(doMes.map(b => b.id));
  const idsAnteriores = new Set(doMes.filter(b => b.id !== atual.id).map(b => b.id));

  const contaPorId = new Map(contas.map(c => [c.id, c]));

  let pagVigente = new Decimal(0);
  const restos: Record<Origem, Decimal> = { tesouro: new Decimal(0), convenio: new Decimal(0), receita: new Decimal(0), nao_classificada: new Decimal(0) };
  const diversos: Record<Origem, Decimal> = { tesouro: new Decimal(0), convenio: new Decimal(0), receita: new Decimal(0), nao_classificada: new Decimal(0) };
  const naoClassificadas = new Set<string>();
  let avisoLegado = false;
  let anulacoes = new Decimal(0);
  let anulCompAnterior = new Decimal(0);

  for (const tx of transacoes) {
    if (!idsPeriodo.has(tx.bt_report_id)) continue;
    const conta = contaPorId.get(tx.account_id);

    if (tx.tipo_movimento === 'saida' && tx.tipo_orcamento != null) {
      const valor = d(tx.valor);
      if (tx.tipo_orcamento === 'vigente') {
        pagVigente = pagVigente.plus(valor);
      } else if (tx.tipo_orcamento === 'restos_pagar') {
        restos[origemDaConta(conta)] = restos[origemDaConta(conta)].plus(valor);
      } else {
        diversos[origemDaConta(conta)] = diversos[origemDaConta(conta)].plus(valor);
      }
      if (origemDaConta(conta) === 'nao_classificada' && conta) naoClassificadas.add(conta.nome);
      // Aviso: pagamento em conta de convênio sem fonte ou com fonte de receita própria
      // não identifica claramente a origem (legado).
      if (conta?.categoria === 'convenio' && !tx.fonte_orcamentaria) avisoLegado = true;
    }

    if (tx.natureza === 'anulacao') {
      anulacoes = anulacoes.plus(d(tx.valor));
      if (tx.competencia_anterior) anulCompAnterior = anulCompAnterior.plus(d(tx.valor));
    }
  }

  // Contábeis: novo = digitado no BT atual; anterior = soma dos "novo" dos BTs anteriores do mês.
  const novoSalvo = linhasSalvas.find(l => l.bt_report_id === atual.id);
  const contabeisAnterior: Record<BudgetType, Decimal> = {
    vigente: new Decimal(0), restos_pagar: new Decimal(0), diversos_credores: new Decimal(0),
  };
  for (const linha of linhasSalvas) {
    if (!linha.bt_report_id || !idsAnteriores.has(linha.bt_report_id)) continue;
    contabeisAnterior.vigente = contabeisAnterior.vigente.plus(d(linha.contabeis_novo_vigente));
    contabeisAnterior.restos_pagar = contabeisAnterior.restos_pagar.plus(d(linha.contabeis_novo_restos));
    contabeisAnterior.diversos_credores = contabeisAnterior.diversos_credores.plus(d(linha.contabeis_novo_diversos));
  }
  const contabeisNovo: Record<BudgetType, Decimal> = {
    vigente: d(novoSalvo?.contabeis_novo_vigente),
    restos_pagar: d(novoSalvo?.contabeis_novo_restos),
    diversos_credores: d(novoSalvo?.contabeis_novo_diversos),
  };
  const contabeisTotal = {
    vigente: contabeisAnterior.vigente.plus(contabeisNovo.vigente),
    restos_pagar: contabeisAnterior.restos_pagar.plus(contabeisNovo.restos_pagar),
    diversos_credores: contabeisAnterior.diversos_credores.plus(contabeisNovo.diversos_credores),
  };

  const ajustePag = d(novoSalvo?.ajuste_total_pagamentos);
  const ajusteAnul = d(novoSalvo?.ajuste_anulacoes);

  const mantaGeral = pagVigente.plus(contabeisTotal.vigente).plus(contabeisTotal.restos_pagar).plus(contabeisTotal.diversos_credores).plus(ajustePag);

  return {
    pagamentosVigenteBanco: num(pagVigente),
    contabeisAnterior: { vigente: num(contabeisAnterior.vigente), restos_pagar: num(contabeisAnterior.restos_pagar), diversos_credores: num(contabeisAnterior.diversos_credores) },
    contabeisTotal: { vigente: num(contabeisTotal.vigente), restos_pagar: num(contabeisTotal.restos_pagar), diversos_credores: num(contabeisTotal.diversos_credores) },
    mantaGeral: num(mantaGeral),
    restosPorOrigem: { tesouro: num(restos.tesouro), convenio: num(restos.convenio), receita: num(restos.receita) },
    diversosPorOrigem: { tesouro: num(diversos.tesouro), convenio: num(diversos.convenio), receita: num(diversos.receita) },
    anulacoes: num(anulacoes.plus(ajusteAnul)),
    anulacoesCompetenciaAnterior: num(anulCompAnterior),
    mantaLiquido: num(mantaGeral.minus(anulacoes).minus(ajusteAnul)),
    avisoLegadoConvenio: avisoLegado,
    contasNaoClassificadas: Array.from(naoClassificadas),
  };
}

// Linhas de comparação: diferença = sistema − informado; OK se |dif| < 0,005.
export interface ComparacaoLinha {
  key: string;
  item: string;
  sistema: number;
  informado: number;
  diferenca: number;
  ok: boolean;
}

const centavos = (n: number): number => Math.round(n * 100);

export function comparar(sistema: number, informado: number): { diferenca: number; ok: boolean } {
  const dif = centavos(sistema) - centavos(informado);
  return { diferenca: dif / 100, ok: Math.abs(dif) < 1 };
}
