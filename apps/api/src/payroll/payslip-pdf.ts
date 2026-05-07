import PDFDocument from 'pdfkit';

export interface PayslipPdfPayload {
  tenant: {
    name:         string;
    tinNumber:    string | null;
    address:      string | null;
    businessName: string | null;
  };
  payslip: {
    employeeName:      string;
    position:          string | null;
    department:        string | null;
    periodStart:       string;       // YYYY-MM-DD
    periodEnd:         string;
    runLabel:          string;
    basicPay:          number;
    overtimePay:       number;
    allowances:        number;
    grossPay:          number;
    sssContrib:        number;
    philhealthContrib: number;
    pagibigContrib:    number;
    withholdingTax:    number;
    otherDeductions:   number;
    totalDeductions:   number;
    netPay:            number;
    regularHours:      number;
    overtimeHours:     number;
  };
}

const CLAY_BROWN = '#8B5E3C';
const CREAM      = '#EEE9DF';
const MUTED      = '#6B7280';

function php(n: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency', currency: 'PHP', minimumFractionDigits: 2,
  }).format(n);
}

/**
 * Generates a single-page A4 payslip PDF using pdfkit (no native deps).
 * Returns a Buffer suitable for piping to res.send() with the right headers.
 */
export function generatePayslipPdf(p: PayslipPdfPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56, // ~20mm
      info: { Title: `Payslip — ${p.payslip.employeeName}`, Author: 'Clerque' },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width  - doc.page.margins.left - doc.page.margins.right;
    const startX    = doc.page.margins.left;

    // ── Header band ──────────────────────────────────────────────────────────
    doc.rect(startX, doc.page.margins.top, pageWidth, 56).fill(CREAM);
    doc.fillColor(CLAY_BROWN).font('Helvetica-Bold').fontSize(20)
       .text(p.tenant.name, startX + 14, doc.page.margins.top + 12);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9);
    if (p.tenant.address) doc.text(p.tenant.address, startX + 14, doc.page.margins.top + 36);
    if (p.tenant.tinNumber) {
      doc.text(`TIN: ${p.tenant.tinNumber}`, startX + 14, doc.page.margins.top + 48);
    }

    // Title strip
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(14)
       .text('PAYSLIP', startX, doc.page.margins.top + 76, { width: pageWidth, align: 'center' });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
       .text(`${p.payslip.runLabel} · ${p.payslip.periodStart} to ${p.payslip.periodEnd}`,
             startX, doc.page.margins.top + 96, { width: pageWidth, align: 'center' });

    // ── Employee block ───────────────────────────────────────────────────────
    let y = doc.page.margins.top + 124;
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(11).text('Employee', startX, y);
    y += 16;
    doc.font('Helvetica').fontSize(10);
    doc.text(`Name:        ${p.payslip.employeeName}`, startX, y); y += 14;
    if (p.payslip.position)   { doc.text(`Position:    ${p.payslip.position}`,   startX, y); y += 14; }
    if (p.payslip.department) { doc.text(`Department:  ${p.payslip.department}`, startX, y); y += 14; }
    doc.text(`Hours:       ${p.payslip.regularHours.toFixed(2)} reg + ${p.payslip.overtimeHours.toFixed(2)} OT`,
             startX, y);
    y += 24;

    // ── Earnings ─────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11).text('Earnings', startX, y);
    y += 6;
    doc.moveTo(startX, y + 10).lineTo(startX + pageWidth, y + 10).strokeColor(CLAY_BROWN).lineWidth(0.6).stroke();
    y += 16;
    const rightCol = startX + pageWidth - 110;

    const earningsRows: [string, number][] = [
      ['Basic Pay',     p.payslip.basicPay],
      ['Overtime Pay',  p.payslip.overtimePay],
      ['Allowances',    p.payslip.allowances],
    ];
    doc.font('Helvetica').fontSize(10);
    for (const [label, amt] of earningsRows) {
      doc.fillColor('#000').text(label, startX, y);
      doc.text(php(amt), rightCol, y, { width: 110, align: 'right' });
      y += 14;
    }
    doc.font('Helvetica-Bold').text('Gross Pay', startX, y + 4);
    doc.text(php(p.payslip.grossPay), rightCol, y + 4, { width: 110, align: 'right' });
    y += 28;

    // ── Deductions ───────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11).text('Deductions', startX, y);
    y += 6;
    doc.moveTo(startX, y + 10).lineTo(startX + pageWidth, y + 10).strokeColor(CLAY_BROWN).lineWidth(0.6).stroke();
    y += 16;
    const deductionRows: [string, number][] = [
      ['SSS Contribution',         p.payslip.sssContrib],
      ['PhilHealth Contribution',  p.payslip.philhealthContrib],
      ['Pag-IBIG Contribution',    p.payslip.pagibigContrib],
      ['Withholding Tax',          p.payslip.withholdingTax],
      ['Other Deductions',         p.payslip.otherDeductions],
    ];
    doc.font('Helvetica').fontSize(10);
    for (const [label, amt] of deductionRows) {
      doc.fillColor('#000').text(label, startX, y);
      doc.text(php(amt), rightCol, y, { width: 110, align: 'right' });
      y += 14;
    }
    doc.font('Helvetica-Bold').text('Total Deductions', startX, y + 4);
    doc.text(php(p.payslip.totalDeductions), rightCol, y + 4, { width: 110, align: 'right' });
    y += 36;

    // ── Net Pay banner ───────────────────────────────────────────────────────
    doc.rect(startX, y, pageWidth, 44).fill(CLAY_BROWN);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(14)
       .text('NET PAY', startX + 14, y + 14);
    doc.fontSize(18)
       .text(php(p.payslip.netPay), startX, y + 12, { width: pageWidth - 14, align: 'right' });
    y += 60;

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
       .text(
         `Generated by Clerque · ${new Date().toISOString().slice(0, 10)} · This is a system-generated document and does not require a signature.`,
         startX, doc.page.height - doc.page.margins.bottom - 20,
         { width: pageWidth, align: 'center' },
       );

    doc.end();
  });
}
