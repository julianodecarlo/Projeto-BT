import type { BudgetType, FonteOrcamentaria, Transaction } from '@/types';

// Estado do card de movimentações de convênios: valores em CENTAVOS (inteiros)
// por (conta, grupo orçamentário, fonte). Funções puras — testáveis sem React.
export type CellCents = Record<BudgetType, Record<FonteOrcamentaria, number>>;
export type CellsByAccount = Record<string, CellCents>;

const FONTES: FonteOrcamentaria[] = ['fonte_5', 'fonte_45', 'fonte_4', 'fonte_44'];
const GRUPOS: BudgetType[] = ['vigente', 'restos_pagar', 'diversos_credores'];

const emptyFontes = (): Record<FonteOrcamentaria, number> => ({
  fonte_5: 0, fonte_45: 0, fonte_4: 0, fonte_44: 0,
});

export const emptyCells = (): CellCents => ({
  vigente: emptyFontes(),
  restos_pagar: emptyFontes(),
  diversos_credores: emptyFontes(),
});

// Snapshot do que está gravado no banco (por conta).
export function buildSnapshot(
  convenioAccountIds: string[],
  pagamentos: Pick<Transaction, 'account_id' | 'tipo_orcamento' | 'fonte_orcamentaria' | 'valor'>[]
): CellsByAccount {
  const state: CellsByAccount = {};
  for (const accId of convenioAccountIds) state[accId] = emptyCells();
  for (const tx of pagamentos) {
    if (!state[tx.account_id]) state[tx.account_id] = emptyCells();
    state[tx.account_id][tx.tipo_orcamento as BudgetType][tx.fonte_orcamentaria as FonteOrcamentaria] =
      Math.round((tx.valor || 0) * 100);
  }
  return state;
}

export function setCell(
  prev: CellsByAccount,
  accId: string,
  grupo: BudgetType,
  fonte: FonteOrcamentaria,
  cents: number
): CellsByAccount {
  const row = prev[accId] ?? emptyCells();
  return { ...prev, [accId]: { ...row, [grupo]: { ...row[grupo], [fonte]: cents } } };
}

export function hasUnsaved(inputs: CellsByAccount, snapshot: CellsByAccount): boolean {
  for (const accId of Object.keys(inputs)) {
    const row = inputs[accId];
    const saved = snapshot[accId] ?? emptyCells();
    for (const g of GRUPOS) {
      for (const f of FONTES) {
        if ((row[g]?.[f] ?? 0) !== saved[g][f]) return true;
      }
    }
  }
  return false;
}

// Saldo projetado da fonte, em centavos: saldo gravado − total digitado (todas as abas).
export function projectedSaldoCents(
  saldoFonte: number,
  inputs: CellsByAccount,
  accId: string,
  fonte: FonteOrcamentaria
): number {
  let digitado = 0;
  const row = inputs[accId];
  if (row) {
    for (const g of GRUPOS) digitado += row[g]?.[fonte] ?? 0;
  }
  return Math.round((saldoFonte || 0) * 100) - digitado;
}

export function totalCentsOf(inputs: CellsByAccount, accId: string, grupo: BudgetType | null): number {
  const row = inputs[accId];
  if (!row) return 0;
  if (grupo) return FONTES.reduce((s, f) => s + (row[grupo]?.[f] ?? 0), 0);
  return GRUPOS.reduce((s, g) => s + FONTES.reduce((s2, f) => s2 + (row[g]?.[f] ?? 0), 0), 0);
}

// Assinatura do conteúdo gravado + escopo: muda SOMENTE quando o BT muda,
// a lista de contas muda ou um pagamento gravado muda de fato (id, conta,
// grupo, fonte ou valor). Nunca por mudança de identidade de arrays.
export function buildSyncSignature(
  btId: string,
  convenioAccountIds: string[],
  pagamentos: Pick<Transaction, 'id' | 'account_id' | 'tipo_orcamento' | 'fonte_orcamentaria' | 'valor'>[]
): string {
  const rows = pagamentos
    .map(p => `${p.id}|${p.account_id}|${p.tipo_orcamento}|${p.fonte_orcamentaria}|${Math.round((p.valor || 0) * 100)}`)
    .sort()
    .join(';');
  return [btId, [...convenioAccountIds].sort().join(','), rows].join('||');
}

// Mescla preservando digitação pendente: células digitadas ficam; células não
// digitadas voltam ao snapshot.
export function mergeTypedCells(prev: CellsByAccount, snapshot: CellsByAccount): CellsByAccount {
  const merged: CellsByAccount = {};
  for (const accId of Object.keys(snapshot)) {
    merged[accId] = emptyCells();
    const prevRow = prev[accId];
    const savedRow = snapshot[accId];
    if (!prevRow) continue;
    for (const g of GRUPOS) {
      for (const f of FONTES) {
        merged[accId][g][f] = prevRow[g]?.[f] ?? savedRow[g][f];
      }
    }
  }
  return merged;
}

export interface ConvenioFontePick {
  finance_account_id: string | null;
  fonte_5: number;
  fonte_45: number;
  fonte_4: number;
  fonte_44: number;
}

export function fonteOf(conv: ConvenioFontePick, fonte: FonteOrcamentaria): number {
  return conv[fonte] ?? 0;
}
