/**
 * Sprint 16 — Subscription receipt PDF generator.
 *
 * Three variants driven by HNS Corp's PlatformConfig.taxStatus:
 *
 *   UNREGISTERED → Acknowledgement Receipt (AR)
 *     - Header: "ACKNOWLEDGEMENT RECEIPT"
 *     - Footer disclaimer: "Not a substitute for an Official Receipt"
 *     - No VAT line (HNS not yet registered)
 *
 *   NON_VAT      → Sales Invoice (SI, NON-VAT)
 *     - Header: "SALES INVOICE"
 *     - "Non-VAT Registered" subtitle
 *     - No VAT line
 *
 *   VAT          → Sales Invoice (SI, VAT)
 *     - Header: "SALES INVOICE"
 *     - "VAT Registered" subtitle
 *     - VAT-able / VAT-exempt / Zero-rated breakdown + Output VAT line
 *
 * All variants share: HNS Corp masthead (TIN, address, contact), customer
 * block (tenant name + TIN), itemized lines, totals, signature blocks.
 */
import PDFDocument from 'pdfkit';

export interface SubscriptionReceiptPayload {
  hns: {
    companyName:     string;
    tin:             string | null;
    address:         string | null;
    contactPhone:    string | null;
    contactEmail:    string | null;
    taxStatus:       'VAT' | 'NON_VAT' | 'UNREGISTERED';
    isBirRegistered: boolean;
  };
  customer: {
    name:    string;
    tin:     string | null;
    address: string | null;
  };
  invoice: {
    number:      string;       // HNS Order.orderNumber
    issueDate:   string;       // ISO
    dueDate:     string | null;
    period:      string;       // "May 2026"
    planCode:    string;
    netAmount:   number;
    vatAmount:   number;
    totalAmount: number;
  };
}

const CLAY_BROWN = '#8B5E3C';
const CREAM      = '#EEE9DF';
const MUTED      = '#6B7280';
const RED_AR     = '#B45309';     // amber-700 — distinguishes AR from SI/OR

function php(n: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency', currency: 'PHP', minimumFractionDigits: 2,
  }).format(n);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'long' });
}

export function generateSubscriptionReceiptPdf(
  p: SubscriptionReceiptPayload,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 50,
      info: { Title: `${receiptTitle(p)} — ${p.invoice.number}`, Author: p.hns.companyName },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // ── Masthead ───────────────────────────────────────────────────────────
    doc.fillColor(CLAY_BROWN).fontSize(18).font('Helvetica-Bold')
       .text(p.hns.companyName, { align: 'left' });
    doc.fillColor(MUTED).fontSize(9).font('Helvetica');
    if (p.hns.address)      doc.text(p.hns.address);
    const contact: string[] = [];
    if (p.hns.contactPhone) contact.push(p.hns.contactPhone);
    if (p.hns.contactEmail) contact.push(p.hns.contactEmail);
    if (contact.length)     doc.text(contact.join(' · '));
    if (p.hns.tin)          doc.text(`TIN: ${p.hns.tin}`);
    if (p.hns.taxStatus === 'VAT')      doc.text('VAT Registered');
    if (p.hns.taxStatus === 'NON_VAT')  doc.text('Non-VAT Registered');

    doc.moveDown(0.5);

    // ── Title bar ──────────────────────────────────────────────────────────
    const titleColor = p.hns.taxStatus === 'UNREGISTERED' ? RED_AR : CLAY_BROWN;
    const yTitle = doc.y;
    doc.rect(doc.page.margins.left, yTitle, pageWidth, 28).fill(CREAM);
    doc.fillColor(titleColor).fontSize(14).font('Helvetica-Bold')
       .text(receiptTitle(p).toUpperCase(), doc.page.margins.left + 12, yTitle + 8, { width: pageWidth - 24 });
    if (p.hns.taxStatus === 'VAT') {
      doc.fillColor(MUTED).fontSize(8).font('Helvetica')
         .text('VAT', doc.page.margins.left + pageWidth - 60, yTitle + 11, { width: 48, align: 'right' });
    }
    doc.y = yTitle + 36;

    // ── Invoice header (number, dates, period) ─────────────────────────────
    doc.fillColor('black').fontSize(10).font('Helvetica');
    const headerY = doc.y;
    doc.text(`No.: ${p.invoice.number}`, doc.page.margins.left, headerY);
    doc.text(`Issue date: ${fmtDate(p.invoice.issueDate)}`, doc.page.margins.left, headerY + 14);
    if (p.invoice.dueDate) {
      doc.text(`Due date: ${fmtDate(p.invoice.dueDate)}`, doc.page.margins.left, headerY + 28);
    }
    doc.text(`Period: ${p.invoice.period}`, doc.page.margins.left + pageWidth / 2, headerY);
    doc.text(`Plan: ${p.invoice.planCode}`, doc.page.margins.left + pageWidth / 2, headerY + 14);

    doc.y = headerY + 50;

    // ── Customer block ────────────────────────────────────────────────────
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('BILL TO');
    doc.fillColor('black').fontSize(11).font('Helvetica-Bold').text(p.customer.name);
    doc.fontSize(9).font('Helvetica');
    if (p.customer.address) doc.text(p.customer.address);
    if (p.customer.tin)     doc.text(`TIN: ${p.customer.tin}`);
    doc.moveDown(1);

    // ── Items table ───────────────────────────────────────────────────────
    const tableY = doc.y;
    doc.rect(doc.page.margins.left, tableY, pageWidth, 22).fill(CREAM);
    doc.fillColor('black').fontSize(9).font('Helvetica-Bold');
    doc.text('DESCRIPTION', doc.page.margins.left + 10, tableY + 7, { width: pageWidth * 0.65 });
    doc.text('AMOUNT', doc.page.margins.left + pageWidth * 0.65 + 10, tableY + 7, { width: pageWidth * 0.30 - 20, align: 'right' });
    doc.y = tableY + 28;

    doc.font('Helvetica').fontSize(10);
    const lineY = doc.y;
    doc.text(
      `Clerque ${p.invoice.planCode} subscription · ${p.invoice.period}`,
      doc.page.margins.left + 10, lineY,
      { width: pageWidth * 0.65 },
    );
    doc.text(php(p.invoice.totalAmount),
      doc.page.margins.left + pageWidth * 0.65 + 10, lineY,
      { width: pageWidth * 0.30 - 20, align: 'right' });
    doc.y = lineY + 24;

    // ── Totals ────────────────────────────────────────────────────────────
    const totalsX = doc.page.margins.left + pageWidth * 0.5;
    const totalsW = pageWidth * 0.5;
    doc.fontSize(9);

    if (p.hns.taxStatus === 'VAT' && p.invoice.vatAmount > 0) {
      // VAT split: net + Output VAT 12% + Total
      doc.text('VAT-able sales:', totalsX, doc.y, { width: totalsW * 0.6, continued: true })
         .text(php(p.invoice.netAmount), { align: 'right' });
      doc.text('Output VAT (12%):', totalsX, doc.y, { width: totalsW * 0.6, continued: true })
         .text(php(p.invoice.vatAmount), { align: 'right' });
    }
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('TOTAL:', totalsX, doc.y, { width: totalsW * 0.6, continued: true })
       .text(php(p.invoice.totalAmount), { align: 'right' });

    doc.moveDown(2);

    // ── Footer per receipt type ───────────────────────────────────────────
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);

    if (p.hns.taxStatus === 'UNREGISTERED') {
      doc.fillColor(RED_AR).font('Helvetica-Bold')
         .text('THIS IS NOT A SUBSTITUTE FOR AN OFFICIAL RECEIPT.', { align: 'center' });
      doc.fillColor(MUTED).font('Helvetica')
         .text(
           `${p.hns.companyName} is in the process of obtaining its BIR Authority to Print. An Official Receipt will be issued retroactively once printing privileges are granted.`,
           { align: 'center', width: pageWidth },
         );
    } else if (!p.hns.isBirRegistered) {
      doc.fillColor(RED_AR)
         .text('PROVISIONAL — pending BIR registration. An Official Receipt will be issued upon completion.', { align: 'center' });
    } else if (p.hns.taxStatus === 'NON_VAT') {
      doc.text('Issued under BIR Form 2303 (Non-VAT). No Input VAT credit applicable.', { align: 'center' });
    } else {
      doc.text('Issued under BIR Form 2303 (VAT). Output VAT remitted via BIR Form 2550Q.', { align: 'center' });
    }

    doc.moveDown(0.5);
    doc.fillColor(MUTED).fontSize(7)
       .text(`Generated by Clerque · ${new Date().toISOString()}`, { align: 'center' });

    doc.end();
  });
}

function receiptTitle(p: SubscriptionReceiptPayload): string {
  if (p.hns.taxStatus === 'UNREGISTERED') return 'Acknowledgement Receipt';
  return 'Sales Invoice';
}
