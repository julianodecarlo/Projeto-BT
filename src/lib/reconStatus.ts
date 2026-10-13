import type { Cheque, DepositPending, PaymentPending, PendencyResolution, Reconciliation } from '@/types';

// Fonte única de verdade do status de conciliação.
// Conciliação Bancária e Fechamento Diário avaliam com esta MESMA fórmula ao vivo
// (Extrato − Rendimentos − Dif.Arred.Rend − Pendências vs Saldo Orçamentário),
// eliminando avisos fantasmas causados por flags gravadas desatualizadas.

export interface OpenItems {
  cheques: Cheque[];
  deposits: DepositPending[];
  payments: PaymentPending[];
}

// Pendências abertas = criadas em qualquer BT, sem baixa no BT atual.
export function getOpenItems(
  cheques: Cheque[],
  deposits: DepositPending[],
  payments: PaymentPending[],
  resolutions: PendencyResolution[],
  currentBtId: string
): OpenItems {
  const resolved = new Set(
    resolutions
      .filter(r => r.bt_report_id === currentBtId)
      .map(r => `${r.kind}:${r.ref_id}`)
  );
  return {
    cheques: cheques.filter(c => !resolved.has(`cheque:${c.id}`)),
    deposits: deposits.filter(d => !resolved.has(`deposito:${d.id}`)),
    payments: payments.filter(p => !resolved.has(`pagamento:${p.id}`)),
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
