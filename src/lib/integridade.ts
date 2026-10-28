import { computeSaldoFinalFromTxs } from './recalc';
import type { Account, Transaction } from '@/types';

export interface DivergenciaAbertura {
  conta: string;
  abertura: number;
  esperado: number;
  diferenca: number;
}

// Função PURA: para cada conta com linhas no BT, compara a abertura gravada
// (saldo_anterior da âncora "Saldo Anterior"; na ausência, o saldo de cadastro)
// com o saldo final do BT anterior da mesma conta, calculado em memória por
// computeSaldoFinalFromTxs (independente de ordem). Tolerância: 0,005.
export function verificarContinuidadeSaldos(
  accounts: Account[],
  txs: Transaction[],
  prevTxs: Transaction[]
): DivergenciaAbertura[] {
  const divergencias: DivergenciaAbertura[] = [];
  for (const acc of accounts) {
    const rows = txs.filter(t => t.account_id === acc.id);
    if (rows.length === 0) continue;

    const anchor = rows.find(t => t.descricao === 'Saldo Anterior');
    const abertura = anchor ? anchor.saldo_anterior : (acc.saldo_inicial ?? 0);

    const prevRows = prevTxs.filter(t => t.account_id === acc.id);
    const esperado = prevRows.length > 0
      ? computeSaldoFinalFromTxs(prevRows, acc.saldo_inicial ?? 0)
      : (acc.saldo_inicial ?? 0);

    const diferenca = abertura - esperado;
    if (Math.abs(diferenca) > 0.005) {
      divergencias.push({ conta: acc.nome ?? '—', abertura, esperado, diferenca });
    }
  }
  return divergencias;
}
