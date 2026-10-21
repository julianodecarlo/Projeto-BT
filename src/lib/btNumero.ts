import type { BtReport } from '@/types';

// "001/2026" -> { seq: 1, ano: 2026 }
export function parseNumero(numero: string): { seq: number; ano: number } | null {
  const m = numero.trim().match(/^(\d{1,3})\s*\/\s*(\d{4})$/);
  if (!m) return null;
  return { seq: parseInt(m[1], 10), ano: parseInt(m[2], 10) };
}

export function formatNumero(seq: number, ano: number): string {
  return `${String(seq).padStart(3, '0')}/${ano}`;
}

// Sugere o próximo número sequencial do ano da data de início informada
export function nextNumeroFor(ano: number, bts: Pick<BtReport, 'numero'>[]): string {
  const maxSeq = bts.reduce((max, bt) => {
    const parsed = parseNumero(bt.numero);
    if (parsed && parsed.ano === ano && parsed.seq > max) return parsed.seq;
    return max;
  }, 0);
  return formatNumero(maxSeq + 1, ano);
}

export function isValidFormatoNumero(numero: string): boolean {
  return /^\d{3}\/\d{4}$/.test(numero.trim());
}
