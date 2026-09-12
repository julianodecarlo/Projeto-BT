import { supabase } from './supabase';
import { formatCurrency, formatDate, toDecimal, toNumber, sumDecimal } from './format';
import type { BtReport, Account, Transaction, RevenueOwn, Cheque, DepositPending, Reconciliation } from '@/types';

interface PdfData {
  bt: BtReport;
  accounts: Account[];
  transactions: Transaction[];
  revenues: RevenueOwn[];
  cheques: Cheque[];
  deposits: DepositPending[];
  reconciliations: Reconciliation[];
}

export async function fetchPdfData(btId: string): Promise<PdfData | null> {
  const { data: bt } = await supabase.from('bt_reports').select('*').eq('id', btId).maybeSingle();
  if (!bt) return null;
  const { data: accounts } = await supabase.from('accounts').select('*').order('ordem');
  const { data: transactions } = await supabase.from('transactions').select('*').eq('bt_report_id', btId).order('ordem');
  const { data: revenues } = await supabase.from('revenue_own').select('*').eq('bt_report_id', btId).order('ordem');
  const { data: cheques } = await supabase.from('cheques').select('*').eq('bt_report_id', btId).order('data_emissao');
  const { data: deposits } = await supabase.from('deposits_pending').select('*').eq('bt_report_id', btId);
  const { data: reconciliations } = await supabase.from('reconciliation').select('*').eq('bt_report_id', btId);
  return {
    bt: bt as BtReport,
    accounts: (accounts || []) as Account[],
    transactions: (transactions || []) as Transaction[],
    revenues: (revenues || []) as RevenueOwn[],
    cheques: (cheques || []) as Cheque[],
    deposits: (deposits || []) as DepositPending[],
    reconciliations: (reconciliations || []) as Reconciliation[],
  };
}

export function generatePdfHtml(data: PdfData): string {
  const { bt, accounts, transactions, revenues, cheques, deposits, reconciliations } = data;

  const activeAccounts = accounts.filter(a => a.ativo);
  const revContabil = revenues.filter(r => r.tipo === 'contabil');
  const revFinanceira = revenues.filter(r => r.tipo === 'financeira');

  const totalEntradas = toNumber(sumDecimal(transactions.filter(t => t.tipo_movimento === 'entrada').map(t => t.valor)));
  const totalSaidas = toNumber(sumDecimal(transactions.filter(t => t.tipo_movimento === 'saida').map(t => t.valor)));

  // Account sections
  const accountSections = activeAccounts.map(acc => {
    const accTxs = transactions.filter(t => t.account_id === acc.id);
    const saldoAtual = accTxs.length > 0 ? accTxs[accTxs.length - 1].saldo_final : acc.saldo_inicial;
    const rows = accTxs.length === 0
      ? '<tr><td colspan="4" style="text-align:center;padding:12px;color:#94a3b8;">Sem movimentações</td></tr>'
      : accTxs.map(t => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${t.descricao}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#64748b;">${t.tipo_orcamento === 'vigente' ? 'Vigente' : t.tipo_orcamento === 'restos_pagar' ? 'Restos a Pagar' : 'Diversos Credores'}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;color:${t.tipo_movimento === 'entrada' ? '#059669' : '#d97706'};font-weight:600;">
            ${t.tipo_movimento === 'entrada' ? '+' : '-'}${formatCurrency(t.valor)}
          </td>
          <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:500;">${formatCurrency(t.saldo_final)}</td>
        </tr>
      `).join('');

    return `
      <div style="margin-bottom:20px;">
        <h3 style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:8px;padding:8px 12px;background:#f8fafc;border-radius:6px;display:flex;justify-content:space-between;">
          <span>${acc.nome} ${acc.codigo ? `(${acc.codigo})` : ''}</span>
          <span>Saldo: ${formatCurrency(saldoAtual)}</span>
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

  // Reconciliation table
  const reconRows = activeAccounts.map(acc => {
    const recon = reconciliations.find(r => r.account_id === acc.id);
    const saldoOrc = transactions.filter(t => t.account_id === acc.id).length > 0
      ? transactions.filter(t => t.account_id === acc.id).slice(-1)[0].saldo_final
      : acc.saldo_inicial;
    return `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${acc.nome}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(saldoOrc)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(recon?.saldo_extrato ?? 0)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(recon?.rendimento_acumulado ?? 0)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${formatCurrency(recon?.saldo_conciliado ?? 0)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:center;">
          ${!recon || (recon.saldo_extrato === 0 && recon.rendimento_acumulado === 0)
            ? '<span style="color:#94a3b8;">Pendente</span>'
            : recon.divergente
              ? '<span style="color:#dc2626;font-weight:600;">Divergente</span>'
              : '<span style="color:#059669;font-weight:600;">OK</span>'
          }
        </td>
      </tr>
    `;
  }).join('');

  // Cheques table
  const chequeRows = cheques.length === 0
    ? '<tr><td colspan="5" style="text-align:center;padding:12px;color:#94a3b8;">Nenhum cheque emitido</td></tr>'
    : cheques.map(c => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${c.numero}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${c.beneficiario}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${formatDate(c.data_emissao)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${formatCurrency(c.valor)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:center;">${c.status === 'compensado' ? 'Compensado' : 'A Compensar'}</td>
      </tr>
    `).join('');

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
    <h1>${bt.instituicao || 'UNIVERSIDADE ESTADUAL PAULISTA'}</h1>
    <h2>${bt.unidade || 'INSTITUTO DE BIOCIÊNCIAS - CÂMPUS DE BOTUCATU'}</h2>
    <h3>Boletim de Tesouraria - Receita Própria</h3>
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
          <th style="text-align:right;">Saldo Conciliado</th>
          <th style="text-align:center;">Status</th>
        </tr>
      </thead>
      <tbody>${reconRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Cheques Emitidos</div>
    <table>
      <thead>
        <tr>
          <th>Número</th>
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
