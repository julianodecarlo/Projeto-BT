import { fetchPdfData } from './btData';
import { formatCurrency, formatDate, toNumber, sumDecimal, rotuloTipoLancamento, toDecimal } from './format';
import { calcularStatusConciliacao, pendenciasPorConta } from './reconStatus';
import { sortAccounts } from './sortAccounts';
import type {
  BtReport,
  Account,
  Transaction,
  RevenueOwn,
  Cheque,
  DepositPending,
  PaymentPending,
  Reconciliation,
} from '@/types';

interface PdfData {
  bt: BtReport;
  accounts: Account[];
  transactions: Transaction[];
  revenues: RevenueOwn[];
  cheques: Cheque[];
  deposits: DepositPending[];
  payments: PaymentPending[];
  reconciliations: Reconciliation[];
}

export function generatePdfHtml(data: PdfData): string {
  const { bt, accounts, transactions, revenues, cheques, deposits, payments, reconciliations } = data;

  const activeAccounts = sortAccounts(accounts.filter(a => a.ativo));
  const revContabil = revenues.filter(r => r.tipo === 'contabil');
  const revFinanceira = revenues.filter(r => r.tipo === 'financeira');

  const totalEntradas = toNumber(sumDecimal(transactions.filter(t => t.tipo_movimento === 'entrada').map(t => t.valor)));
  const totalSaidas = toNumber(sumDecimal(transactions.filter(t => t.tipo_movimento === 'saida').map(t => t.valor)));

  // Account sections — ordem lógica por conta:
  // 1. Saldo Anterior (Saldo Inicial) · 2. Depósitos · 3. Transferências entre
  // Contas · 4. Orçamento Vigente · 5. Restos a Pagar · 6. Diversos Credores ·
  // 7. Saldo Final. A coluna Saldo é progressiva linha a linha:
  // Saldo(N) = Saldo(N-1) ± Valor(N), partindo do saldo ancorado.
  const rankMovimento = (t: Transaction): number => {
    if (t.descricao === 'Saldo Anterior') return 0;
    if (t.tipo === 'deposito_anulacao') return 1;
    if (t.tipo != null) return 2; // repasses e transferências entre contas
    if (t.tipo_orcamento === 'vigente') return 3;
    if (t.tipo_orcamento === 'restos_pagar') return 4;
    return 5; // diversos_credores
  };

  const accountSections = activeAccounts.map(acc => {
    const accTxs = transactions.filter(t => t.account_id === acc.id);
    const anchor = accTxs.find(t => t.descricao === 'Saldo Anterior');
    const saldoInicial = anchor ? (anchor.saldo_anterior || 0) : (acc.saldo_inicial || 0);

    const ordered = [...accTxs].sort(
      (a, b) => rankMovimento(a) - rankMovimento(b) || (a.ordem ?? 0) - (b.ordem ?? 0)
    );

    // Saldo progressivo: cada movimentação ajusta o saldo da linha anterior.
    let running = toDecimal(saldoInicial);
    const lines = ordered.map(t => {
      const v = toDecimal(t.valor || 0);
      if (t.descricao !== 'Saldo Anterior') {
        running = t.tipo_movimento === 'entrada' ? running.plus(v) : running.minus(v);
      }
      return { t, saldo: running.toNumber() };
    });
    const saldoFinal = running.toNumber();

    const rows = lines.length === 0
      ? '<tr><td colspan="4" style="text-align:center;padding:12px;color:#94a3b8;">Sem movimentações</td></tr>'
      : lines.map(({ t, saldo }) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${t.descricao}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#64748b;">${rotuloTipoLancamento(t, acc.categoria)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;color:${t.tipo_movimento === 'entrada' ? '#059669' : '#d97706'};font-weight:600;">
            ${t.tipo_movimento === 'entrada' ? '+' : '-'}${formatCurrency(t.descricao === 'Saldo Anterior' ? saldoInicial : t.valor)}
          </td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:500;">${formatCurrency(saldo)}</td>
        </tr>
      `).join('') + `
        <tr>
          <td style="padding:6px 10px;border-top:2px solid #1e293b;font-weight:700;">Saldo Final</td>
          <td style="padding:6px 10px;border-top:2px solid #1e293b;font-size:11px;color:#64748b;font-weight:700;">Saldo Final</td>
          <td style="padding:6px 10px;border-top:2px solid #1e293b;text-align:right;color:#059669;font-weight:600;">+${formatCurrency(0)}</td>
          <td style="padding:6px 10px;border-top:2px solid #1e293b;text-align:right;font-weight:700;">${formatCurrency(saldoFinal)}</td>
        </tr>
      `;

    return `
      <div style="margin-bottom:20px;">
        <h3 style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:8px;padding:8px 12px;background:#f8fafc;border-radius:6px;display:flex;justify-content:space-between;">
          <span>${acc.nome} ${acc.codigo ? `(${acc.codigo})` : ''}</span>
          <span>Saldo: ${formatCurrency(saldoFinal)}</span>
        </h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#f1f5f9;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">
              <th style="padding:6px 10px;text-align:left;">Descrição</th>
              <th style="padding:6px 10px;text-align:left;">Tipo</th>
              <th style="padding:6px 10px;text-align:right;">Valor</th>
              <th style="padding:6px 10px;text-align:right;">Saldo</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }).join('');

  // Conciliação Bancária — FONTE ÚNICA: a MESMA função da aba Conciliação
  // (calcularStatusConciliacao) calcula Saldo Conciliado e Status, garantindo
  // que o PDF espelhe exatamente a tela. Fórmula aplicada:
  // Saldo Conciliado = Saldo Extrato − Rendimentos − Dif.Arred.Rend − Pendências
  const pendMap = pendenciasPorConta({ cheques, deposits, payments });
  const statusPorConta = calcularStatusConciliacao({ accounts, transactions, reconciliations, pendMap });
  const reconRows = statusPorConta.map(x => {
    const statusHtml = x.status === 'Conciliado'
      ? '<span style="color:#059669;font-weight:600;">Conciliado</span>'
      : x.status === 'Divergente'
        ? `<span style="color:#dc2626;font-weight:600;">Divergente${x.dif !== 0 ? ` (Dif: ${formatCurrency(x.dif)})` : ''}</span>`
        : '<span style="color:#94a3b8;">Pendente</span>';
    return `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${x.acc.nome}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(x.saldoOrcamentario)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(x.recon?.saldo_extrato ?? 0)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(x.recon?.rendimento_acumulado ?? 0)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(x.recon?.ajuste_arredondamento ?? 0)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(pendMap.get(x.acc.id) ?? 0)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${formatCurrency(x.saldoConciliado)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:center;">${statusHtml}</td>
      </tr>
    `;
  }).join('');

  // Cheques a Compensar — mesma estrutura da aba Conciliação: agrupados por
  // conta corrente, com colunas completas e total por grupo.
  const chequeGroups = activeAccounts
    .map(acc => ({ acc, rows: cheques.filter(c => c.account_id === acc.id) }))
    .filter(g => g.rows.length > 0)
    .map(g => `
      <tr>
        <td colspan="6" style="padding:6px 10px;background:#f8fafc;font-weight:700;font-size:11px;color:#334155;text-transform:uppercase;letter-spacing:0.5px;">
          Conta: ${g.acc.nome}${g.acc.codigo ? ` (${g.acc.codigo})` : ''} — ${g.rows.length} cheque(s) — Total: ${formatCurrency(toNumber(sumDecimal(g.rows.map(c => c.valor))))}
        </td>
      </tr>
      ${g.rows.map(c => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${g.acc.nome}</td>
          <td style="padding:6px 10px 6px 10px;border-bottom:1px solid #f1f5f9;">${c.numero}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${c.beneficiario}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${formatDate(c.data_emissao)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(c.valor)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:center;">A Compensar</td>
        </tr>
      `).join('')}
    `).join('');
  const chequeRows = cheques.length === 0
    ? '<tr><td colspan="6" style="text-align:center;padding:12px;color:#94a3b8;">Nenhum cheque a compensar</td></tr>'
    : chequeGroups;

  // Deposits table
  const depositRows = deposits.length === 0
    ? '<tr><td colspan="3" style="text-align:center;padding:12px;color:#94a3b8;">Nenhum depósito pendente</td></tr>'
    : deposits.map(d => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${accounts.find(a => a.id === d.account_id)?.nome || '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${d.descricao || '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(d.valor)}</td>
      </tr>
    `).join('');

  // RP Contábil
  const revContRows = revContabil.length === 0
    ? '<tr><td colspan="3" style="text-align:center;padding:12px;color:#94a3b8;">Nenhuma receita contábil</td></tr>'
    : revContabil.map(r => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${r.subalinea}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(r.saldo_anterior)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;color:#059669;">${formatCurrency(r.arrecadacao)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${formatCurrency(r.saldo_final_contabil)}</td>
      </tr>
    `).join('');

  // RP Financeira
  const revFinRows = revFinanceira.length === 0
    ? '<tr><td colspan="5" style="text-align:center;padding:12px;color:#94a3b8;">Nenhuma receita financeira</td></tr>'
    : revFinanceira.map(r => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${r.subalinea}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(r.saldo_anterior)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(r.caixa)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(r.bancos)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${formatCurrency(r.saldo_final_financeiro)}</td>
      </tr>
    `).join('');

  const statusLabel = bt.status === 'fechado' ? 'FECHADO' : bt.status === 'validado' ? 'VALIDADO' : 'RASCUNHO';
  const statusColor = bt.status === 'fechado' ? '#059669' : bt.status === 'validado' ? '#d97706' : '#94a3b8';

  // Resumo por Subalínea: consolidação das subalíneas do Controle da Receita
  // (contábil + financeira), exibida após as tabelas de Receitas Próprias.
  const subalineaMap = new Map<string, { codigo: string; nome: string; contabil: number; financeira: number }>();
  for (const r of revenues) {
    const partes = r.subalinea.split(' - ');
    const codigo = /^\d+$/.test(partes[0].trim()) ? partes[0].trim() : '—';
    const nome = /^\d+$/.test(partes[0].trim()) ? partes.slice(1).join(' - ').trim() : r.subalinea;
    const entry = subalineaMap.get(r.subalinea) || { codigo, nome, contabil: 0, financeira: 0 };
    if (r.tipo === 'contabil') entry.contabil = toDecimal(entry.contabil).plus(toDecimal(r.saldo_final_contabil)).toNumber();
    else entry.financeira = toDecimal(entry.financeira).plus(toDecimal(r.saldo_final_financeiro)).toNumber();
    subalineaMap.set(r.subalinea, entry);
  }
  const subalineas = [...subalineaMap.values()].sort(
    (a, b) => (a.codigo === '—' ? 1 : 0) - (b.codigo === '—' ? 1 : 0) ||
      (a.codigo !== '—' && b.codigo !== '—' ? Number(a.codigo) - Number(b.codigo) : 0)
  );
  const totalGeralSubalineas = toNumber(sumDecimal(
    subalineas.map(s => toDecimal(s.contabil).plus(toDecimal(s.financeira)).toNumber())
  ));
  const subalineaRows = subalineas.length === 0
    ? '<tr><td colspan="5" style="text-align:center;padding:12px;color:#94a3b8;">Nenhuma subalínea registrada</td></tr>'
    : subalineas.map(s => {
        const total = toDecimal(s.contabil).plus(toDecimal(s.financeira)).toNumber();
        return `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${s.codigo}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${s.nome}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(s.contabil)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(s.financeira)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${formatCurrency(total)}</td>
      </tr>
    `;
      }).join('') + `
      <tr>
        <td colspan="4" style="padding:8px 10px;background:#f8fafc;font-weight:700;text-align:right;">Saldo Total Geral</td>
        <td style="padding:8px 10px;background:#f8fafc;font-weight:700;text-align:right;">${formatCurrency(totalGeralSubalineas)}</td>
      </tr>
    `;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>BT_${bt.numero}_${formatDate(bt.data).replace(/\//g, '-')}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica', 'Arial', sans-serif; color: #1e293b; padding: 30px; font-size: 12px; line-height: 1.5; }
  @page { size: A4; margin: 15mm; }
  .header { text-align: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #1e293b; }
  .header h1 { font-size: 16px; font-weight: 700; text-transform: uppercase; }
  .header h2 { font-size: 13px; font-weight: 600; margin-top: 4px; color: #475569; }
  .header h3 { font-size: 12px; font-weight: 500; margin-top: 4px; color: #64748b; }
  .bt-info { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 10px 16px; background: #f8fafc; border-radius: 8px; }
  .bt-info .num { font-size: 18px; font-weight: 700; }
  .bt-info .date { font-size: 13px; color: #475569; }
  .bt-info .status { padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 700; color: white; background: ${statusColor}; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; text-align: left; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
  .summary-card { padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 8px; }
  .summary-card .label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .summary-card .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
  .signatures { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 20px; }
  .sig-box { text-align: center; width: 45%; }
  .sig-line { border-top: 1px solid #1e293b; padding-top: 6px; margin-top: 40px; }
  .sig-name { font-weight: 600; font-size: 12px; }
  .sig-role { font-size: 11px; color: #64748b; margin-top: 2px; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 10px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="header">
    <h1>UNIVERSIDADE ESTADUAL PAULISTA</h1>
    <h2>INSTITUTO DE BIOCIÊNCIAS CÂMPUS DE BOTUCATU</h2>
    <h3>BT - Boletim de Tesouraria e Caixa</h3>
  </div>

  <div class="bt-info">
    <div>
      <span class="num">BT ${bt.numero}</span>
      <span class="date" style="margin-left:12px;">Data: ${formatDate(bt.data)}</span>
    </div>
    <span class="status">${statusLabel}</span>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="label">Total Entradas</div>
      <div class="value" style="color:#059669;">${formatCurrency(totalEntradas)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Total Saídas</div>
      <div class="value" style="color:#d97706;">${formatCurrency(totalSaidas)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Lançamentos</div>
      <div class="value">${transactions.length}</div>
    </div>
    <div class="summary-card">
      <div class="label">Contas Ativas</div>
      <div class="value">${activeAccounts.length}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Movimentações por Conta</div>
    ${accountSections}
  </div>

    <div class="section">
      <div class="section-title">Conciliação Bancária</div>
      <table>
        <thead>
          <tr>
            <th>Conta</th>
            <th style="text-align:right;">Saldo Orçamentário</th>
            <th style="text-align:right;">Saldo Extrato</th>
            <th style="text-align:right;">Rendimentos</th>
            <th style="text-align:right;">Dif.Arred.Rend</th>
            <th style="text-align:right;">Pendências</th>
            <th style="text-align:right;">Saldo Conciliado</th>
            <th style="text-align:center;">Status</th>
          </tr>
        </thead>
        <tbody>${reconRows}</tbody>
      </table>
    </div>

  <div class="section">
    <div class="section-title">Cheques a Compensar</div>
    <table>
      <thead>
        <tr>
          <th>Número</th>
          <th>Conta</th>
          <th>Beneficiário</th>
          <th>Data</th>
          <th style="text-align:right;">Valor</th>
          <th style="text-align:center;">Status</th>
        </tr>
      </thead>
      <tbody>${chequeRows}</tbody>
    </table>
  </div>
  <div class="section">
    <div class="section-title">Depósitos Pendentes</div>
    <table>
      <thead>
        <tr>
          <th>Conta</th>
          <th>Descrição</th>
          <th style="text-align:right;">Valor</th>
        </tr>
      </thead>
      <tbody>${depositRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Receitas Próprias - Contábil (3 Colunas)</div>
    <table>
      <thead>
        <tr>
          <th>Subalínea</th>
          <th style="text-align:right;">Saldo Anterior</th>
          <th style="text-align:right;">Arrecadação</th>
          <th style="text-align:right;">Saldo Final</th>
        </tr>
      </thead>
      <tbody>${revContRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Receitas Próprias - Financeira (4 Colunas)</div>
    <table>
      <thead>
        <tr>
          <th>Subalínea</th>
          <th style="text-align:right;">Saldo Anterior</th>
          <th style="text-align:right;">Caixa</th>
          <th style="text-align:right;">Bancos</th>
          <th style="text-align:right;">Saldo Final</th>
        </tr>
      </thead>
      <tbody>${revFinRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Resumo por Subalínea</div>
    <table>
      <thead>
        <tr>
          <th>Código</th>
          <th>Subalínea</th>
          <th style="text-align:right;">Saldo Contábil</th>
          <th style="text-align:right;">Saldo Financeiro</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${subalineaRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Boletim de Caixa e Demonstrativos de D\u00e9bito/Cr\u00e9dito</div>
    <table>
      <thead>
        <tr>
          <th>Conta</th>
          <th style="text-align:right;">Saldo Anterior</th>
          <th style="text-align:right;">D\u00e9bitos (Sa\u00eddas)</th>
          <th style="text-align:right;">Cr\u00e9ditos (Entradas)</th>
          <th style="text-align:right;">Saldo Final</th>
        </tr>
      </thead>
      <tbody>
        ${activeAccounts.map(acc => {
          const accTxs = transactions.filter(t => t.account_id === acc.id);
          const saldoAnt = accTxs.length > 0 ? accTxs[0].saldo_anterior : acc.saldo_inicial;
          const saldoFin = accTxs.length > 0 ? accTxs[accTxs.length - 1].saldo_final : acc.saldo_inicial;
          const debitos = toNumber(sumDecimal(accTxs.filter(t => t.tipo_movimento === 'saida').map(t => t.valor)));
          const creditos = toNumber(sumDecimal(accTxs.filter(t => t.tipo_movimento === 'entrada').map(t => t.valor)));
          return `
            <tr>
              <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${acc.nome}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(saldoAnt)}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;color:#d97706;">${formatCurrency(debitos)}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;color:#059669;">${formatCurrency(creditos)}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${formatCurrency(saldoFin)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  </div>

  <div class="signatures">
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-name">${bt.elaborado_por || '____________________________'}</div>
      <div class="sig-role">${bt.cargo_elaborado || 'Elaborado por'}</div>
    </div>
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-name">${bt.conferido_por || '____________________________'}</div>
      <div class="sig-role">${bt.cargo_conferido || 'Conferido por'}</div>
    </div>
  </div>

  <div class="footer">
    Documento gerado em ${new Date().toLocaleString('pt-BR')} · BT ${bt.numero} · ${formatDate(bt.data)}
  </div>
</body>
</html>`;
}

export async function generateAndDownloadPdf(btId: string): Promise<void> {
  const data = await fetchPdfData(btId);
  if (!data) return;
  const html = generatePdfHtml(data);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) {
    win.onload = () => {
      win.print();
    };
  }
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function previewPdf(btId: string): Promise<string | null> {
  const data = await fetchPdfData(btId);
  if (!data) return null;
  return generatePdfHtml(data);
}
