// Teste de unidade da lib de Entradas e Repasses (etapa 2).
// Executar: npx tsx src/lib/__tests__/entradasRepasses.test.ts
// Cenário: 3 BTs no mesmo mês (outubro/2026), pagamentos de Tesouro/Receita/
// Convênio (fontes 5/45/4/44), uma anulação com competência anterior, contábeis
// em dois BTs (anterior + novo) e conferência de cada linha.
import { calcularSistema, comparar, origemDaConta, periodoDoMes, type SavedEntradasRepasses } from '../entradasRepasses';
import type { Account, BtReport, Transaction } from '@/types';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FALHOU: ${name}`); } else { console.log(`ok: ${name}`); }
}
const eq = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

const bt = (id: string, numero: string, data: string, created: string): Pick<BtReport, 'id' | 'numero' | 'data' | 'created_at'> =>
  ({ id, numero, data, created_at: created });

const bts = [
  bt('bt-a', '170/2026', '2026-10-05', '2026-10-06T10:00:00Z'),
  bt('bt-b', '171/2026', '2026-10-15', '2026-10-16T10:00:00Z'),
  bt('bt-c', '172/2026', '2026-10-25', '2026-10-26T10:00:00Z'),
  bt('bt-fora', '169/2026', '2026-09-30', '2026-10-01T10:00:00Z'),
];

const contas: Pick<Account, 'id' | 'categoria' | 'nome'>[] = [
  { id: 'acc-tes', categoria: 'movimento', nome: 'Tesouro' },
  { id: 'acc-rec', categoria: 'receita', nome: 'Receita' },
  { id: 'acc-diarias', categoria: 'diarias', nome: 'Diárais' },
  { id: 'acc-conv', categoria: 'convenio', nome: 'FNDE 916962/2021' },
  { id: 'acc-caucao', categoria: 'caucao', nome: 'Caução' },
];

const tx = (
  id: string, btId: string, accId: string, valor: number,
  opts: Partial<Pick<Transaction, 'tipo_movimento' | 'tipo_orcamento' | 'natureza' | 'fonte_orcamentaria' | 'competencia_anterior' | 'tipo'>> = {}
): Pick<Transaction, 'id' | 'bt_report_id' | 'account_id' | 'valor' | 'tipo_movimento' | 'tipo_orcamento' | 'natureza' | 'fonte_orcamentaria' | 'competencia_anterior' | 'tipo'> =>
  ({ id, bt_report_id: btId, account_id: accId, valor, tipo_movimento: 'saida', tipo_orcamento: 'vigente', natureza: null, fonte_orcamentaria: null, competencia_anterior: false, tipo: null, ...opts });

const transacoes = [
  // BT-A: pagamentos vigente — Tesouro 1000, Diárias 200 (vigente), Receita 500, Convênio F5 300 + F45 100, legado convênio 50
  tx('t1', 'bt-a', 'acc-tes', 1000),
  tx('t2', 'bt-a', 'acc-diarias', 200),
  tx('t3', 'bt-a', 'acc-rec', 500),
  tx('t4', 'bt-a', 'acc-conv', 300, { fonte_orcamentaria: 'fonte_5' }),
  tx('t5', 'bt-a', 'acc-conv', 100, { fonte_orcamentaria: 'fonte_45' }),
  tx('t6', 'bt-a', 'acc-conv', 50), // legado (sem fonte) — gera aviso
  // BT-A: restos — Tesouro 100; diversos — Receita 40
  tx('t7', 'bt-a', 'acc-tes', 100, { tipo_orcamento: 'restos_pagar' }),
  tx('t8', 'bt-a', 'acc-rec', 40, { tipo_orcamento: 'diversos_credores' }),
  // t9/t10/t17: anulações são ENTRADAS (não pagamentos)
  tx('t9', 'bt-a', 'acc-rec', 100, { natureza: 'anulacao', tipo: 'deposito_anulacao', tipo_movimento: 'entrada', competencia_anterior: true }),
  tx('t10', 'bt-a', 'acc-tes', 40, { natureza: 'anulacao', tipo: 'deposito_anulacao', tipo_movimento: 'entrada' }),
  tx('t11', 'bt-a', 'acc-tes', 999, { natureza: 'deposito', tipo: 'deposito_anulacao', tipo_movimento: 'entrada' }),
  // BT-B: pagamentos vigente — Tesouro 2000, Receita 700, Convênio F4 300 + F44 150; restos Tesouro 100
  tx('t12', 'bt-b', 'acc-tes', 2000),
  tx('t13', 'bt-b', 'acc-rec', 700),
  tx('t14', 'bt-b', 'acc-conv', 300, { fonte_orcamentaria: 'fonte_4' }),
  tx('t15', 'bt-b', 'acc-conv', 150, { fonte_orcamentaria: 'fonte_44' }),
  tx('t16', 'bt-b', 'acc-tes', 100, { tipo_orcamento: 'restos_pagar' }),
  // BT-B: anulação 200
  tx('t17', 'bt-b', 'acc-tes', 200, { natureza: 'anulacao', tipo: 'deposito_anulacao', tipo_movimento: 'entrada' }),
  // BT-C (atual): pagamentos vigente — Tesouro 500; restos Convênio 80; diversos Tesouro 30
  tx('t18', 'bt-c', 'acc-tes', 500),
  tx('t19', 'bt-c', 'acc-conv', 80, { tipo_orcamento: 'restos_pagar' }),
  tx('t20', 'bt-c', 'acc-tes', 30, { tipo_orcamento: 'diversos_credores' }),
  // Fora do período (setembro) — não entra
  tx('t21', 'bt-fora', 'acc-tes', 10000),
];

const linhasSalvas: Pick<SavedEntradasRepasses, 'bt_report_id' | 'contabeis_novo_vigente' | 'contabeis_novo_restos' | 'contabeis_novo_diversos' | 'ajuste_total_pagamentos' | 'ajuste_anulacoes'>[] = [
  { bt_report_id: 'bt-a', contabeis_novo_vigente: 150, contabeis_novo_restos: 0, contabeis_novo_diversos: 10 },
  { bt_report_id: 'bt-b', contabeis_novo_vigente: 250, contabeis_novo_restos: 20, contabeis_novo_diversos: 0 },
  // bt-c ainda não salvo: novo contábil digitado na tela (simulado abaixo)
];

// Simula o que a tela grava no BT atual (novo contábil 120 vigente / 5 restos / 0 diversos).
const linhasComAtual = [...linhasSalvas, { bt_report_id: 'bt-c', contabeis_novo_vigente: 120, contabeis_novo_restos: 5, contabeis_novo_diversos: 0 }];

// Classificação de contas
check('tesouro -> tesouro', origemDaConta(contas[0]) === 'tesouro');
check('diarias -> tesouro', origemDaConta(contas[2]) === 'tesouro');
check('receita -> receita', origemDaConta(contas[1]) === 'receita');
check('convenio -> convenio', origemDaConta(contas[3]) === 'convenio');
check('caucao -> nao_classificada', origemDaConta(contas[4]) === 'nao_classificada');

// Período: mesmo mês, data <= atual
const periodo = periodoDoMes(bts[2], bts);
check('período = 3 BTs de outubro', periodo.length === 3 && periodo[0].id === 'bt-a' && periodo[2].id === 'bt-c');
check('BT de setembro fora', !periodo.some(b => b.id === 'bt-fora'));

const r = calcularSistema(bts[2], bts, transacoes, contas, linhasComAtual);

// 1) pag_vigente_banco: BT-A 1000+200+500+300+100+50=2150; BT-B 2000+700+300+150=3150; BT-C 500 → 5800
check('pagamentos vigente (bancário) = 5800', eq(r.pagamentosVigenteBanco, 5800));
// 2) contábeis: anterior 150+250=400 vigente / 20 restos / 10 diversos; + novo 120/5/0
check('contábeis anterior vigente = 400', eq(r.contabeisAnterior.vigente, 400));
check('contábeis total vigente = 520', eq(r.contabeisTotal.vigente, 520));
check('contábeis total restos = 25', eq(r.contabeisTotal.restos_pagar, 25));
check('contábeis total diversos = 10', eq(r.contabeisTotal.diversos_credores, 10));
// 3) Manta Geral = 5800 + 520 + 25 + 10 = 6355
check('Manta Geral = 6355', eq(r.mantaGeral, 6355));
// 4) Restos por origem: Tesouro 100+100+... (BT-A 100 + BT-B 100) + Convênio 80; Receita 0
check('restos Tesouro = 200', eq(r.restosPorOrigem.tesouro, 200));
check('restos Convênio = 80', eq(r.restosPorOrigem.convenio, 80));
check('restos Receita = 0', eq(r.restosPorOrigem.receita, 0));
// 5) Diversos: Receita 40; Tesouro 30
check('diversos Receita = 40', eq(r.diversosPorOrigem.receita, 40));
check('diversos Tesouro = 30', eq(r.diversosPorOrigem.tesouro, 30));
// 6) Anulações: 100+40 (BT-A) + 200 (BT-B) = 340; competência anterior 60
check('anulações = 340', eq(r.anulacoes, 340));
check('anulações competência anterior = 100', eq(r.anulacoesCompetenciaAnterior, 100));
// 7) Manta Líquido = 6355 − 340 = 6015
check('Manta Líquido = 6015', eq(r.mantaLiquido, 6015));
// Avisos
check('aviso legado convênio', r.avisoLegadoConvenio === true);
check('contas não classificadas vazias (nenhum pagamento em caucao)', r.contasNaoClassificadas.length === 0);

// Comparação
check('igual -> OK', comparar(6355, 6355).ok === true);
check('diferença de meio centavo -> OK (tolerância |dif|<0,005)', comparar(100.00, 100.004).ok === true);
check('diferença de R$ 1,00 -> não OK', comparar(100.00, 101.00).ok === false);
check('diferença = sistema − informado', comparar(100.00, 101.00).diferenca === -1);

if (failures > 0) { console.error(`\n${failures} teste(s) falharam.`); process.exit(1); }
console.log('\nTodos os testes passaram.');
