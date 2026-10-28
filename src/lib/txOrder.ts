import type { Transaction } from '@/types';

// Comparador único de ordem de linhas dentro de um BT:
// 1) âncora "Saldo Anterior" SEMPRE primeiro, por conta;
// 2) demais linhas por ordem asc, created_at asc, id asc.
// Usado por forceRecalcBtSaldos, listTransactions, listAccountTransactions,
// fetchLastSaldoFinal e pelos seletores de "última linha".
export function compareTxRows(a: Transaction, b: Transaction): number {
  const aAnchor = a.descricao === 'Saldo Anterior' ? 0 : 1;
  const bAnchor = b.descricao === 'Saldo Anterior' ? 0 : 1;
  if (aAnchor !== bAnchor) return aAnchor - bAnchor;

  const ordemDiff = (a.ordem || 0) - (b.ordem || 0);
  if (ordemDiff !== 0) return ordemDiff;

  const aCreated = a.created_at || '';
  const bCreated = b.created_at || '';
  if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Ordena uma lista de transações no padrão acima (não muta o array original).
export function sortTxRows<T extends Transaction>(txs: T[]): T[] {
  return [...txs].sort(compareTxRows);
}
