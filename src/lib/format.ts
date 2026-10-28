import Decimal from 'decimal.js';
import type { Account, Transaction } from '@/types';

export function formatCurrency(value: number | null | undefined): string {
  const v = value ?? 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export function formatNumber(value: number | null | undefined): string {
  const v = value ?? 0;
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateInput(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toDecimal(value: number | string | null | undefined): Decimal {
  return new Decimal(value ?? 0);
}

export function toNumber(d: Decimal): number {
  return d.toNumber();
}

export function sum(values: (number | null | undefined)[]): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

export function sumDecimal(values: (number | string | null | undefined)[]): Decimal {
  return values.reduce((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

// Rotulagem oficial do campo 'TIPO' nos extratos do BT (tela e PDF).
// 'Orçamento Vigente', 'Restos a Pagar' e 'Diversos Credores' se aplicam
// EXCLUSIVAMENTE à liquidação de pagamentos/despesas orçamentárias.
// Transferências entre contas, repasses, aberturas de saldo, a Conta Diárias
// (execução exclusiva de Orçamento Vigente) e as Contas de Convênio NUNCA
// recebem rótulo de categoria orçamentária.
export function rotuloTipoLancamento(
  t: Pick<Transaction, 'descricao' | 'tipo' | 'tipo_orcamento' | 'natureza'>,
  categoria?: Account['categoria']
): string {
  if (t.descricao === 'Saldo Anterior') return 'Saldo Inicial';
  if (t.tipo === 'repasse_reitoria') return 'Repasse da Reitoria';
  if (t.tipo === 'transf_livre' || t.tipo === 'transf_tesouro_receita' || t.tipo === 'transf_tesouro_diarias') {
    return 'Transf. entre Contas';
  }
  if (t.tipo === 'deposito_anulacao') {
    if (t.natureza) return t.natureza === 'anulacao' ? 'Anulação de Despesa' : 'Depósito';
    return t.descricao.toLowerCase().includes('anula') ? 'Anulação de Despesa' : 'Depósito';
  }
  if (categoria === 'convenio') return 'Conta Convênio';
  if (categoria === 'diarias') return 'Orçamento Vigente';
  if (t.tipo_orcamento === 'vigente') return 'Orçamento Vigente';
  if (t.tipo_orcamento === 'restos_pagar') return 'Restos a Pagar';
  if (t.tipo_orcamento === 'diversos_credores') return 'Diversos Credores';
  return 'Movimento';
}
