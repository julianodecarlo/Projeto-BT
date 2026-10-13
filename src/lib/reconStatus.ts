import type { Cheque, DepositPending, PaymentPending, Reconciliation } from '@/types';

// Fonte única de verdade do status de conciliação.
// Conciliação Bancária e Fechamento Diário avaliam com esta MESMA fórmula ao vivo
// (Extrato − Rendimentos − Dif.Arred.Rend − Pendências vs Saldo Orçamentário),
// eliminando avisos fantasmas causados por flags gravadas desatualizadas.

export interface OpenItems {
  cheques: Cheque[];
  deposits: DepositPending[];
  payments: PaymentPending[];
}

// Pendências abertas = registros SEM baixa permanente no banco de dados.
// A baixa é gravada no registro original (status do cheque/depósito/pagamento)
// e vale para TODOS os BTs: um item compensado/pago/realizado nunca mais
// reaparece, nem em BTs futuros nem ao reabrir BTs anteriores.
export function getOpenItems(
  cheques: Cheque[],
  deposits: DepositPending[],
  payments: PaymentPending[]
): OpenItems {
  return {
    cheques: cheques.filter(c => c.status !== 'compensado'),
    deposits: deposits.filter(d => (d as unknown as { status?: string }).status === 'pendente'),
    payments: payments.filter(p => (p as unknown as { status?: string }).status === 'pendente'),
  };
}

export function pendenciasPorConta(items: OpenItems): Map<string, number> {
  const map = new Map<string, number>();
  const add = (accId: string, v: number) => map.set(accId, (map.get(accId) ?? 0) + v);
  for (const c of items.cheques) add(c.account_id, c.valor);
  for (const p of items.payments) add(p.account_id, p.valor);
  for (const d of items.deposits) add(d.account_id, d.valor);
  return map;
}

export interface ReconStatus {
  pendente: boolean;   // sem lançamento de extrato
  divergente: boolean;
  conciliado: boolean;
  saldoConciliado: number;
}

export function getReconStatus(
  recon: Reconciliation | undefined,
  pendencias: number,
  saldoOrcamentario: number
): ReconStatus {
  const extratoVazio = !recon || recon.saldo_extrato === 0;
  if (extratoVazio) return { pendente: true, divergente: false, conciliado: false, saldoConciliado: 0 };

  const saldoConc = Math.round(
    (recon.saldo_extrato - recon.rendimento_acumulado - recon.ajuste_arredondamento - pendencias) * 100
  ) / 100;
  const divergente = Math.round(saldoConc * 100) !== Math.round(saldoOrcamentario * 100);
  return { pendente: false, divergente, conciliado: !divergente, saldoConciliado: saldoConc };
}
