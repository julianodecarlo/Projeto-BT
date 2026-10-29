import { calcularSistema } from '../src/lib/entradasRepasses';
import type { Account, Transaction } from '@/types';

const bts = [
  { id: 'bt-a', numero: '170', data: '2026-10-05', created_at: '2026-10-06T10:00:00Z' },
  { id: 'bt-b', numero: '171', data: '2026-10-15', created_at: '2026-10-16T10:00:00Z' },
  { id: 'bt-c', numero: '172', data: '2026-10-25', created_at: '2026-10-26T10:00:00Z' },
];
const contas: Pick<Account, 'id' | 'categoria' | 'nome'>[] = [
  { id: 'acc-tes', categoria: 'movimento', nome: 'Tesouro' },
  { id: 'acc-rec', categoria: 'receita', nome: 'Receita' },
  { id: 'acc-diarias', categoria: 'diarias', nome: 'Diárais' },
  { id: 'acc-conv', categoria: 'convenio', nome: 'FNDE' },
];
const mk = (id: string, btId: string, accId: string, valor: number, o: Partial<Transaction> = {}): Pick<Transaction, 'id' | 'bt_report_id' | 'account_id' | 'valor' | 'tipo_movimento' | 'tipo_orcamento' | 'natureza' | 'fonte_orcamentaria' | 'competencia_anterior' | 'tipo'> =>
  ({ id, bt_report_id: btId, account_id: accId, valor, tipo_movimento: 'saida', tipo_orcamento: 'vigente', natureza: null, fonte_orcamentaria: null, competencia_anterior: false, tipo: null, ...o });
const txs = [
  mk('t1', 'bt-a', 'acc-tes', 1000),
  mk('t2', 'bt-a', 'acc-diarias', 200),
  mk('t3', 'bt-a', 'acc-rec', 500),
  mk('t4', 'bt-a', 'acc-conv', 300, { fonte_orcamentaria: 'fonte_5' }),
  mk('t5', 'bt-a', 'acc-conv', 100, { fonte_orcamentaria: 'fonte_45' }),
  mk('t6', 'bt-a', 'acc-conv', 50),
  mk('t12', 'bt-b', 'acc-tes', 2000),
  mk('t13', 'bt-b', 'acc-rec', 700),
  mk('t14', 'bt-b', 'acc-conv', 300, { fonte_orcamentaria: 'fonte_4' }),
  mk('t15', 'bt-b', 'acc-conv', 150, { fonte_orcamentaria: 'fonte_44' }),
  mk('t18', 'bt-c', 'acc-tes', 500),
  mk('t9', 'bt-a', 'acc-rec', 100, { natureza: 'anulacao', tipo: 'deposito_anulacao', competencia_anterior: true }),
  mk('t10', 'bt-a', 'acc-tes', 40, { natureza: 'anulacao', tipo: 'deposito_anulacao' }),
  mk('t17', 'bt-b', 'acc-tes', 200, { natureza: 'anulacao', tipo: 'deposito_anulacao' }),
];
const r = calcularSistema(bts[2], bts as never, txs as never, contas, []);
console.log(JSON.stringify(r, null, 1));
