/**
 * InvoicePdfService — renders a 1-page customer-facing PDF for an AR invoice.
 *
 * Sprint 22 — table stakes. Before this, an ARInvoice couldn't be sent to
 * the customer at all.
 *
 * Layout (top-down, single A4 page):
 *   1. Tenant chrome header (business name + address + TIN + VAT-status)
 *   2. "INVOICE" label + invoice number + status badge
 *   3. Customer "Bill To" block + invoice metadata (dates, terms, reference)
 *   4. Lines table (description / qty / unit price / line total)
 *   5. Totals block right-aligned (subtotal, VAT, total, paid, balance)
 *   6. Payment instructions footer
 *
 * Styled after scripts/gen-audit-report-pdf.js (brown / cream / ink palette)
 * but trimmed to a short business document — no cover page, no TOC.
 *
 * Layout rule (copied verbatim from the audit-report comment): when in flow
 * mode use doc.text() with no absolute coords; when drawing the totals
 * block we briefly drop into absolute mode and reset doc.y on the way out.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';

const BROWN = '#8B5E3C';
const CREAM = '#EEE9DF';
const INK   = '#1F1B16';
const MUTED = '#5C5650';
const RULE  = '#D4CFC4';

const PAGE_MARGIN = 48;

function peso(n: number | string | { toString(): string }): string {
  const v = typeof n === 'number' ? n : Number(n.toString());
  if (!Number.isFinite(v)) return '₱ 0.00';
  return '₱ ' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' });
}

@Injectable()
export class InvoicePdfService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Render a finished invoice PDF as a Buffer. Throws 404 if the invoice
   * doesn't exist or doesn't belong to the tenant. Callers are responsible
   * for sending Content-Type and Content-Disposition headers.
   */
  async renderInvoicePdf(tenantId: string, invoiceId: string): Promise<Buffer> {
    const invoice = await this.prisma.aRInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: {
        lines:    { include: { account: { select: { code: true, name: true } } } },
        customer: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where:  { id: tenantId },
      select: {
        name: true, businessName: true,
        tin:  true, tinNumber: true,
        address: true, registeredAddress: true,
        taxStatus: true, contactEmail: true, contactPhone: true,
      },
    });

    const businessName = tenant.businessName ?? tenant.name;
    const tin          = tenant.tinNumber ?? tenant.tin ?? '';
    const address      = tenant.registeredAddress ?? tenant.address ?? '';
    const vatLabel     = tenant.taxStatus === 'VAT' ? 'VAT-Registered'
                       : tenant.taxStatus === 'NON_VAT' ? 'Non-VAT'
                       : 'Unregistered';

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
      const chunks: Buffer[] = [];
      doc.on('data',  (c: Buffer) => chunks.push(c));
      doc.on('end',   ()          => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        this.drawHeader(doc, businessName, address, tin, vatLabel, tenant.contactEmail, tenant.contactPhone);
        this.drawInvoiceMeta(doc, invoice);
        this.drawCustomerBlock(doc, invoice);
        this.drawLines(doc, invoice.lines);
        this.drawTotals(doc, invoice);
        this.drawFooter(doc, invoice);
      } catch (err) {
        return reject(err as Error);
      }
      doc.end();
    });
  }

  // ── Sections ────────────────────────────────────────────────────────────

  private drawHeader(
    doc: PDFKit.PDFDocument,
    name: string, address: string, tin: string, vatLabel: string,
    email: string | null, phone: string | null,
  ) {
    // Color band at the top — a slim brown stripe + cream backdrop
    doc.save();
    doc.rect(0, 0, doc.page.width, 6).fill(BROWN);
    doc.restore();

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(name, PAGE_MARGIN, PAGE_MARGIN);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    if (address) doc.text(address);
    const tinLine = [`TIN: ${tin || 'N/A'}`, vatLabel].filter(Boolean).join('   |   ');
    doc.text(tinLine);
    const contact = [email, phone].filter(Boolean).join('   |   ');
    if (contact) doc.text(contact);
    doc.moveDown(0.5);

    // Rule
    const ruleY = doc.y + 2;
    doc.moveTo(PAGE_MARGIN, ruleY).lineTo(doc.page.width - PAGE_MARGIN, ruleY).strokeColor(RULE).lineWidth(0.5).stroke();
    doc.moveDown(0.7);
  }

  private drawInvoiceMeta(doc: PDFKit.PDFDocument, invoice: any) {
    const y0 = doc.y;
    // Big "INVOICE" label on the right
    doc.font('Helvetica-Bold').fontSize(20).fillColor(BROWN)
       .text('INVOICE', PAGE_MARGIN, y0, { align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(INK)
       .text(`#${invoice.invoiceNumber}`, { align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
       .text(`Status: ${invoice.status}`, { align: 'right' });
    doc.moveDown(0.6);
  }

  /** Two-column block: customer (left) + invoice metadata (right). */
  private drawCustomerBlock(doc: PDFKit.PDFDocument, invoice: any) {
    const customer = invoice.customer;
    const startY   = doc.y;
    const colW     = (doc.page.width - PAGE_MARGIN * 2) / 2;
    const rightX   = PAGE_MARGIN + colW;

    // ── Left: BILL TO ─────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
       .text('BILL TO', PAGE_MARGIN, startY);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
       .text(customer?.name ?? 'Walk-in Customer', PAGE_MARGIN, doc.y, { width: colW - 10 });
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    if (customer?.address)      doc.text(customer.address, { width: colW - 10 });
    if (customer?.tin)          doc.text(`TIN: ${customer.tin}`);
    if (customer?.contactEmail) doc.text(customer.contactEmail);
    const leftEndY = doc.y;

    // ── Right: INVOICE DETAILS ────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
       .text('INVOICE DETAILS', rightX, startY);
    let y = doc.y;
    const writeKV = (k: string, v: string) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(k, rightX, y, { width: 110 });
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(v, rightX + 95, y, { width: colW - 100 });
      y = doc.y + 1;
    };
    writeKV('Invoice Date:', fmtDate(invoice.invoiceDate));
    writeKV('Due Date:',     fmtDate(invoice.dueDate));
    writeKV('Terms:',        invoice.termsDays ? `Net ${invoice.termsDays}` : 'Cash');
    if (invoice.reference) writeKV('Reference:', String(invoice.reference));

    // Move cursor past whichever column is lower
    doc.y = Math.max(leftEndY, y) + 12;
  }

  private drawLines(doc: PDFKit.PDFDocument, lines: any[]) {
    // Section header bar
    const headerY = doc.y;
    doc.save();
    doc.rect(PAGE_MARGIN, headerY, doc.page.width - PAGE_MARGIN * 2, 16).fill(CREAM);
    doc.restore();

    const colX = {
      desc:  PAGE_MARGIN + 6,
      qty:   doc.page.width - PAGE_MARGIN - 240,
      unit:  doc.page.width - PAGE_MARGIN - 160,
      total: doc.page.width - PAGE_MARGIN - 80,
    };

    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
    doc.text('Description', colX.desc, headerY + 4);
    doc.text('Qty',         colX.qty,  headerY + 4);
    doc.text('Unit Price',  colX.unit, headerY + 4);
    doc.text('Line Total',  colX.total, headerY + 4, { width: 70, align: 'right' });

    doc.y = headerY + 18;
    doc.font('Helvetica').fontSize(9).fillColor(INK);

    for (const line of lines) {
      const yStart = doc.y;
      const descText = line.description || line.account?.name || 'Item';
      doc.text(descText, colX.desc, yStart, { width: colX.qty - colX.desc - 8 });
      const descBottom = doc.y;
      doc.text(String(Number(line.quantity)),  colX.qty,  yStart);
      doc.text(peso(line.unitPrice),           colX.unit, yStart);
      doc.text(peso(line.lineTotal),           colX.total, yStart, { width: 70, align: 'right' });
      doc.y = Math.max(descBottom, yStart + 12) + 2;
      // thin separator
      doc.moveTo(PAGE_MARGIN, doc.y).lineTo(doc.page.width - PAGE_MARGIN, doc.y)
         .strokeColor(RULE).lineWidth(0.3).stroke();
      doc.y += 2;
    }
  }

  private drawTotals(doc: PDFKit.PDFDocument, invoice: any) {
    doc.moveDown(0.5);
    const rightEdge = doc.page.width - PAGE_MARGIN;
    const labelX    = rightEdge - 200;
    const valueX    = rightEdge - 80;
    let y = doc.y;

    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(INK);
      doc.text(label, labelX, y, { width: 110 });
      doc.text(value, valueX, y, { width: 80, align: 'right' });
      y += 14;
    };

    row('Subtotal:',    peso(invoice.subtotal));
    row('VAT:',         peso(invoice.vatAmount));
    row('Total:',       peso(invoice.totalAmount), true);
    row('Paid:',        peso(invoice.paidAmount));
    row('Balance Due:', peso(invoice.balanceAmount), true);

    doc.y = y + 4;
  }

  private drawFooter(doc: PDFKit.PDFDocument, invoice: any) {
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('PAYMENT INSTRUCTIONS', PAGE_MARGIN, doc.y);
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    doc.text(
      `Please remit ${peso(invoice.balanceAmount)} on or before ${fmtDate(invoice.dueDate)}. ` +
      `Reference invoice #${invoice.invoiceNumber} in your payment memo. ` +
      `Contact us if you need an alternative payment channel.`,
      { width: doc.page.width - PAGE_MARGIN * 2 },
    );
    doc.moveDown(0.6);
    doc.fontSize(8).fillColor(MUTED).text(
      `Generated by Clerque on ${new Date().toLocaleString('en-PH')}. This document is computer-generated; ` +
      `no signature is required.`,
      { width: doc.page.width - PAGE_MARGIN * 2, align: 'center' },
    );
  }
}
