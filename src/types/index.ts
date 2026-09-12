export type BtStatus = 'rascunho' | 'validado' | 'fechado';

export type AccountCategory =
  | 'movimento'
  | 'receita'
  | 'diarias'
  | 'convenio'
  | 'caucao'
  | 'deposito_judicial';

export type BudgetType = 'vigente' | 'restos_pagar' | 'diversos_credores';

export type MovementType = 'entrada' | 'saida';

export type RevenueType = 'contabil' | 'financeira';

export type ChequeStatus = 'a_compensar' | 'compensado';

export type ConvenioSourceType = 'convenio' | 'receita';

export interface BtReport {
  id: string;
  numero: string;
  data: string;
  status: BtStatus;
  instituicao: string;
  unidade: string;
  elaborado_por: string | null;
  cargo_elaborado: string | null;
  conferido_por: string | null;
  cargo_conferido: string | null;
  created_at: string;
}

export interface Account {
  id: string;
  nome: string;
  categoria: AccountCategory;
  codigo: string | null;
  ativo: boolean;
  ordem: number;
  saldo_inicial: number;
  created_at: string;
}

export interface Convenio {
  id: string;
  nome: string;
  account_id: string | null;
  created_at: string;
}

export interface ConvenioSource {
  id: string;
  convenio_id: string;
  tipo: ConvenioSourceType;
  codigo_vigente: string;
  codigo_superavit: string;
  created_at: string;
}

export interface Transaction {
  id: string;
  bt_report_id: string;
  account_id: string;
  descricao: string;
  tipo_orcamento: BudgetType | null;
  tipo_movimento: MovementType;
  valor: number;
  saldo_anterior: number;
  saldo_final: number;
  data_lancamento: string | null;
  ordem: number;
  created_at: string;
}

export interface RevenueOwn {
  id: string;
  bt_report_id: string;
  subalinea: string;
  tipo: RevenueType;
  saldo_anterior: number;
  arrecadacao: number;
  saldo_final_contabil: number;
  caixa: number;
  bancos: number;
  saldo_final_financeiro: number;
  account_id: string | null;
  ordem: number;
  created_at: string;
}

export interface Cheque {
  id: string;
  bt_report_id: string | null;
  account_id: string;
  data_emissao: string;
  numero: string;
  valor: number;
  beneficiario: string;
  status: ChequeStatus;
  created_at: string;
}

export interface DepositPending {
  id: string;
  bt_report_id: string | null;
  account_id: string;
  valor: number;
  descricao: string | null;
  created_at: string;
}

export interface Reconciliation {
  id: string;
  bt_report_id: string;
  account_id: string;
  saldo_extrato: number;
  rendimento_acumulado: number;
  saldo_conciliado: number;
  saldo_orcamentario: number;
  divergente: boolean;
  created_at: string;
}

export interface Subalinea {
  id: string;
  codigo: string;
  descricao: string;
  ativo: boolean;
  ordem: number;
  created_at: string;
}
