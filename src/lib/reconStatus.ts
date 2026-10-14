import type { BtReport, Account, Transaction, Cheque, DepositPending, PaymentPending, PendencyResolution, Reconciliation } from '@/types';

// Fonte única de verdade do status de conciliação.
// Conciliação Bancária e Fechamento Diário avaliam com esta MESMA fórmula ao vivo
// (Extrato − Rendimentos − Dif.Arred.Rend − Pendências vs Saldo Orçamentário).
//
// PADRÃO DE FOTOGRAFIA ESTÁTICA (SNAPSHOT POR BT):
// Cada BT enxerga as pendências conforme a foto gravada no SEU período:
//   - Entram no cômputo as pendências CRIADAS até o BT (criação <= data do BT);
//   - Saem do cômputo as baixadas EM OU ANTES do BT (baixa <= data do BT).
// Uma baixa dada em um BT futuro nunca altera a foto de BTs anteriores:
//   o cheque que estava 'A Compensar' no BT 170 continua 'A Compensar' na
//   foto do 170, mesmo tendo sido compensado durante o BT 171.

export interface OpenItems {
  cheques: Cheque[];
  deposits: DepositPending[];
  payments: PaymentPending[];
}

export interface SnapshotSource {
  cheques: Cheque[];
  deposits: DepositPending[];
  payments: PaymentPending[];
  resolutions: PendencyResolution[];
}

// Foto estática das pendências para um dado BT. `bts` traz id e data de
// todos os BTs (incluindo o atual) para posicionar criações e baixas na linha
// do tempo. Sem a linha do tempo, cai no comportamento de visão global.
export function getOpenItems(
  src: SnapshotSource,
  bt: Pick<BtReport, 'id' | 'data'>,
  bts: Pick<BtReport, 'id' | 'data'>[]
): OpenItems {
  const dataById = new Map(bts.map(b => [b.id, b.data]));
  const btData = dataById.get(bt.id) ?? bt.data;
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  // Baixa é válida para a foto do BT se foi dada em um BT cuja data <= data do BT atual.
  const baixadoAte = (refId: string, kind: PendencyResolution['kind']) =>
    src.resolutions.some(
      r => r.kind === kind && r.ref_id === refId && cmp(dataById.get(r.bt_report_id) ?? '9999-12-31', btData) <= 0
    );

  const foiCriadoAte = (btReportId: string | null) => {
    if (!btReportId) return true; // registro antigo sem vínculo de BT: mantém visibilidade global
    const d = dataById.get(btReportId);
    return !d || cmp(d, btData) <= 0;
  };

  return {
    cheques: src.cheques.filter(c => foiCriadoAte(c.bt_report_id) && !baixadoAte(c.id, 'cheque')),
    deposits: src.deposits.filter(d => foiCriadoAte(d.bt_report_id) && !baixadoAte(d.id, 'deposito')),
    payments: src.payments.filter(p => foiCriadoAte(p.bt_report_id) && !baixadoAte(p.id, 'pagamento')),
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

import Decimal from 'decimal.js';

// calcularStatusConciliacao — FONTE ÚNICA do status por conta, compartilhada
// pela Conciliação Bancária, pelo Fechamento Diário e pela validação central
// (botão Validar BT). Recebe o que as duas abas já têm em memória e devolve o
// MESMO status que aparece no badge da Conciliação: 'Conciliado', 'Divergente'
// (com a diferença exata do badge) ou 'Pendente'.
export interface StatusConta {
  acc: Account;
  recon: Reconciliation | undefined;
  status: 'Conciliado' | 'Divergente' | 'Pendente';
  dif: number;           // diferença exata mostrada no badge (saldoConciliado − saldoOrcamentário)
  saldoConciliado: number;
  saldoOrcamentario: number;
  isConvenio: boolean;
}

export function calcularStatusConciliacao(params: {
  accounts: Account[];
  transactions: Transaction[];
  reconciliations: Reconciliation[];
  pendMap: Map<string, number>;
}): StatusConta[] {
  const { accounts, transactions, reconciliations, pendMap } = params;
  return accounts.filter(a => a.ativo).map(acc => {
    const recon = reconciliations.find(r => r.account_id === acc.id);
    const accTxs = transactions.filter(t => t.account_id === acc.id);
    // MESMA leitura da aba Conciliação Bancária: o Saldo Orçamentário é o
    // saldo final da ÚLTIMA linha da conta (corrente completa), que já incorpora
    // transferências enviadas/recebidas, repasses, depósitos e as colunas
    // orçamentárias. NUNCA re-somar por "âncora" aqui: quando o Saldo Anterior
    // já reflete lançamentos gravados junto dele, a re-soma conta o valor em
    // dobro e cria divergência fantasma (ex.: R$ 595,00 no lugar de R$ 70,00).
    let saldoOrc = acc.saldo_inicial;
    if (accTxs.length > 0) {
      saldoOrc = accTxs[accTxs.length - 1].saldo_final;
    }
    const pend = pendMap.get(acc.id) ?? 0;
    const st = getReconStatus(recon, pend, saldoOrc);
    const label: StatusConta['status'] = st.pendente ? 'Pendente' : st.divergente ? 'Divergente' : 'Conciliado';
    return {
      acc,
      recon,
      status: label,
      dif: Math.round((st.saldoConciliado - saldoOrc) * 100) / 100,
      saldoConciliado: st.saldoConciliado,
      saldoOrcamentario: saldoOrc,
      isConvenio: acc.categoria === 'convenio',
    };
  });
}
