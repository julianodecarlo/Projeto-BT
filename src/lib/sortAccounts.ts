import type { Account } from '@/types';

// Ordenação global padrão de contas bancárias, aplicada em todas as abas,
// modais e selects:
//   1º Conta Tesouro · 2º Conta Receita · 3º Conta Diárias
//   · demais contas mantendo a ordem de cadastro (ordem/id original).
// Prioriza `ordem` dentro de cada grupo (ordem cronológica de criação),
// caindo para o id quando ambos são iguais.
const PRIORIDADE: Account['categoria'][] = ['movimento', 'receita', 'diarias'];

export function sortAccounts(accounts: Account[]): Account[] {
  const prioridadeDe = (acc: Account): number => {
    const idx = PRIORIDADE.indexOf(acc.categoria);
    return idx === -1 ? PRIORIDADE.length : idx;
  };
  return [...accounts].sort((a, b) => {
    const p = prioridadeDe(a) - prioridadeDe(b);
    if (p !== 0) return p;
    if (a.ordem !== b.ordem) return a.ordem - b.ordem;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
