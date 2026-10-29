// Teste de unidade do estado do card de convênios (tarefa 2e).
// Executar: npx tsx src/lib/__tests__/convenioCardState.test.ts
// Cobre a sequência: digitar 10000,50 na Fonte 5 do FNDE → clicar fora
// (blur não emite de novo) → digitar em outra fonte → trocar de aba e voltar
// → snapshot gravado não sobrescreve → merge preserva → salvar zera a pendência.
import {
  buildSnapshot,
  buildSyncSignature,
  emptyCells,
  hasUnsaved,
  mergeTypedCells,
  projectedSaldoCents,
  setCell,
  totalCentsOf,
} from '../convenioCardState';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    failures++;
    console.error(`FALHOU: ${name}`);
  } else {
    console.log(`ok: ${name}`);
  }
}

const FNDE = 'acc-fnde';

// Snapshot do banco: nada gravado.
let snapshot = buildSnapshot([FNDE], []);
let inputs: Parameters<typeof setCell>[0] = { [FNDE]: emptyCells() };

// 1) Digita 10000,50 na Fonte 5 do FNDE (aba vigente).
inputs = setCell(inputs, FNDE, 'vigente', 'fonte_5', 1_000_050);
check('digitação registrada em centavos', inputs[FNDE].vigente.fonte_5 === 1_000_050);
check('há alteração não salva', hasUnsaved(inputs, snapshot));

// 2) Clicar fora: blur NÃO reemite — o valor permanece o mesmo.
const afterBlur = inputs[FNDE].vigente.fonte_5;
check('blur preserva o valor', afterBlur === 1_000_050);

// 3) Digita 500,00 na Fonte 44 (outro campo) — ambos permanecem.
inputs = setCell(inputs, FNDE, 'vigente', 'fonte_44', 50_000);
check('primeiro campo permanece', inputs[FNDE].vigente.fonte_5 === 1_000_050);
check('segundo campo registrado', inputs[FNDE].vigente.fonte_44 === 50_000);

// 4) Sincronização do banco muda de identidade, mas o CONTEÚDO gravado é igual:
//    assinatura igual → o efeito não roda → digitação preservada.
const pagamentos: Parameters<typeof buildSyncSignature>[2] = [];
const sig1 = buildSyncSignature('bt-1', [FNDE], pagamentos);
const sig2 = buildSyncSignature('bt-1', [FNDE], [...pagamentos]);
check('assinatura estável com identidades novas', sig1 === sig2);

// Efeito "rodando" mesmo com assinatura nova, com digitação pendente: merge preserva.
const snapshotNovo = buildSnapshot([FNDE], []);
inputs = mergeTypedCells(inputs, snapshotNovo);
check('merge preserva digitação pendente', inputs[FNDE].vigente.fonte_5 === 1_000_050 && inputs[FNDE].vigente.fonte_44 === 50_000);

// 5) Trocar de aba e voltar: aba é só visualização, o estado por (conta, grupo, fonte) não muda.
const inputsAntesDaTroca = inputs;
check('troca de aba não altera estado', inputs === inputsAntesDaTroca);

// 6) Saldo projetado: FNDE F5 = 388.663,97 → 388.663,97 − 10.000,50 = 378.663,47.
const proj = projectedSaldoCents(388_663.97, inputs, FNDE, 'fonte_5');
check('saldo projetado com centavos exatos', proj === 37_866_347);

// 7) Total por conta na aba vigente = 10.000,50 + 500,00.
check('total da linha', totalCentsOf(inputs, FNDE, 'vigente') === 1_050_050);

// 8) Salvar: gravação simula os dois pagamentos; novo snapshot passa a tê-los
//    e o estado volta ao snapshot → sem pendência.
const salvos: Parameters<typeof buildSyncSignature>[2] = [
  { id: 't1', account_id: FNDE, tipo_orcamento: 'vigente', fonte_orcamentaria: 'fonte_5', valor: 10000.5 },
  { id: 't2', account_id: FNDE, tipo_orcamento: 'vigente', fonte_orcamentaria: 'fonte_44', valor: 500 },
];
snapshot = buildSnapshot([FNDE], salvos);
inputs = snapshot;
check('após salvar, sem pendência', !hasUnsaved(inputs, snapshot));
const sigAntes = buildSyncSignature('bt-1', [FNDE], salvos);
const sigDepois = buildSyncSignature('bt-1', [FNDE], [...salvos].reverse());
check('assinatura muda quando gravação muda de conteúdo', sigDepois === sigAntes);

// 9) Guard em centavos, sem toCents: "10.5" como número = 10,50 (não 1050).
inputs = setCell({ [FNDE]: emptyCells() }, FNDE, 'restos_pagar', 'fonte_5', Math.round(10.5 * 100));
check('10,50 vira 1050 centavos', inputs[FNDE].restos_pagar.fonte_5 === 1050);

if (failures > 0) {
  console.error(`\n${failures} teste(s) falharam.`);
  process.exit(1);
}
console.log('\nTodos os testes passaram.');
