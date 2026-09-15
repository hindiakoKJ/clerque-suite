import { Injectable, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as crypto from 'crypto';
import { PH_TIMEZONE } from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ProcureService } from './procure.service';
import { plainNotes, readTag } from './procure-notes';
import { planBuyListRows, SheetRow, ExistingLine, PlanVerdict } from './buy-lists-plan';

/**
 * The buy lists as an Excel file: the backup the owner can read, edit and
 * upload back.
 *
 * Procure stays the one place purchases are recorded. The file is the same
 * lines seen another way -- every row carries the line's control number, so
 * an upload lands on exactly the line it came from -- and it can only RECORD:
 * packs, pack size, price and brand on a line not yet in stock, or a purchase
 * made away from the app, which becomes a bought request marked as coming
 * from the sheet. Nothing goes into stock or the books from the file; "Post
 * to stock" on the request does that, with its usual checks.
 *
 * An upload is shown first (what changes, what is new, what is refused and
 * why, by Excel row number) and only applied when confirmed.
 */

const SHEET_MARK = 'Recorded from an Excel upload';
const MAX_DAYS = 366;
const MAX_REQUESTS = 2000;
/** Written into the workbook's keywords, so a file from another shop is not read into this one. */
const TENANT_MARK = 'clerque-tenant:';

/** The Lines sheet's columns, in order. Import reads them by heading, so a moved column still reads. */
const COLUMNS = [
  { key: 'lineNumber',   header: 'Line No.',             width: 22 },
  { key: 'requestNumber', header: 'Request No.',         width: 19 },
  { key: 'branch',       header: 'Branch',               width: 14 },
  { key: 'item',         header: 'Item',                 width: 30 },
  { key: 'unit',         header: 'Unit',                 width: 7 },
  { key: 'needed',       header: 'Needed',               width: 10 },
  { key: 'boughtOn',     header: 'Bought on',            width: 12 },
  { key: 'packs',        header: 'Packs bought',         width: 9 },
  { key: 'packSize',     header: 'Pack size',            width: 9 },
  { key: 'packUnit',     header: 'Pack unit',            width: 8 },
  { key: 'pricePerPack', header: 'Price per pack (PHP)', width: 12 },
  { key: 'amount',       header: 'Amount (PHP)',         width: 12 },
  { key: 'brand',        header: 'Brand / store',        width: 20 },
  { key: 'status',       header: 'Status',               width: 16 },
  { key: 'inStockOn',    header: 'In stock on',          width: 12 },
  // Hidden: the row's key, and what it held when downloaded (so an edit is told from a change made in Clerque since).
  { key: 'rowKey',       header: 'Row key',              width: 14 },
  { key: 'wasItem',      header: 'Was item',             width: 14 },
  { key: 'wasBoughtOn',  header: 'Was bought on',        width: 12 },
  { key: 'wasPacks',     header: 'Was packs',            width: 10 },
  { key: 'wasPackSize',  header: 'Was pack size',        width: 10 },
  { key: 'wasPrice',     header: 'Was price',            width: 10 },
  { key: 'wasBrand',     header: 'Was brand',            width: 14 },
] as const;
const HIDDEN = ['rowKey', 'wasItem', 'wasBoughtOn', 'wasPacks', 'wasPackSize', 'wasPrice', 'wasBrand'] as const;
const COL = Object.fromEntries(COLUMNS.map((c, i) => [c.key, i + 1])) as Record<(typeof COLUMNS)[number]['key'], number>;
const letter = (n: number) => String.fromCharCode(64 + n);
/** Filled in by Clerque; an edit there is ignored or refused. */
const READ_ONLY = ['requestNumber', 'unit', 'needed', 'status', 'inStockOn'] as const;
const SPARE_ROWS = 30;

export interface SheetPlanResult {
  preview: boolean;
  counts: { unchanged: number; fill: number; new: number; refused: number };
  rows: Array<PlanVerdict & { applied?: 'done' | 'failed'; message?: string; requestNumber?: string }>;
}

@Injectable()
export class BuyListsExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly procure: ProcureService,
  ) {}

  // ── the download ──────────────────────────────────────────────────────────

  async exportWorkbook(tenantId: string, opts: { from: string; to: string; branchId?: string | null }): Promise<{ buffer: Buffer; filename: string }> {
    const { from, to } = this.range(opts.from, opts.to);
    const start = manilaMidnight(from);
    const end = new Date(manilaMidnight(to).getTime() + 86_400_000);
    const branchFilter = opts.branchId ? { branchId: await this.procure.resolveBranch(tenantId, opts.branchId) } : {};
    const inRange = { tenantId, ...branchFilter, OR: [{ createdAt: { gte: start, lt: end } }, { boughtAt: { gte: start, lt: end } }] };
    // Never a file that quietly stops at the cap: a backup that is missing the newest lists is worse than a refusal.
    const count = await this.prisma.purchaseRequest.count({ where: inRange });
    if (count > MAX_REQUESTS) {
      throw new BadRequestException(`${count.toLocaleString('en-PH')} buy lists in these dates; ${MAX_REQUESTS.toLocaleString('en-PH')} at most in one file. Narrow the dates.`);
    }

    const [requests, materials, branches] = await Promise.all([
      this.prisma.purchaseRequest.findMany({
        where:   inRange,
        include: { branch: { select: { name: true } }, lines: { include: { rawMaterial: { select: { name: true, unit: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.rawMaterial.findMany({
        where:   { tenantId, isActive: true },
        select:  {
          id: true, name: true, unit: true, lowStockAlert: true,
          subRecipeItems: { select: { id: true }, take: 1 },
          bomItems: { where: { product: { isActive: true } }, select: { id: true }, take: 1 },
          usedInSubRecipes: { select: { id: true }, take: 1 },
          inventory: { select: { branchId: true, quantity: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.branch.findMany({ where: { tenantId, isActive: true, ...(opts.branchId ? { id: branchFilter.branchId } : {}) }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';
    wb.keywords = `${TENANT_MARK}${tenantId}`;
    // Every formula also carries its value, and Excel recalculates on open.
    wb.calcProperties.fullCalcOnLoad = true;

    // ── Lines ────────────────────────────────────────────────────────────────
    const ws = wb.addWorksheet('Lines', { views: [{ state: 'frozen', ySplit: 1 }] });
    const suffix = (n: string) => parseInt(/-(\d+)$/.exec(n)?.[1] ?? '0', 10);
    type Cell = string | number | null | { formula: string; result: number | string };
    const data: Cell[][] = [];
    for (const r of requests) {
      const boughtOn = r.boughtAt ? manilaDay(r.boughtAt) : '';
      for (const l of [...r.lines].sort((a, b) => suffix(a.lineNumber) - suffix(b.lineNumber))) {
        const i = data.length + 2;
        const packs = l.packsBought != null ? Number(l.packsBought) : null;
        const cost = l.packCost != null ? Number(l.packCost) : null;
        const size = l.packSize != null ? Number(l.packSize) : null;
        data.push([
          l.lineNumber, r.requestNumber, r.branch?.name ?? '', l.rawMaterial.name, l.rawMaterial.unit, Number(l.qtyRequested),
          boughtOn || null, packs, size, l.rawMaterial.unit, cost,
          this.amountFormula(i, packs != null && cost != null ? +(packs * cost).toFixed(2) : ''),
          l.brandNote ?? '', lineStatus(r.status, l), l.receivedAt ? manilaDay(l.receivedAt) : null,
          '', l.rawMaterial.name, boughtOn || '', packs, size, cost, l.brandNote ?? '',
        ]);
      }
    }
    // Blank rows to add a purchase made away from the app: Line No. left empty.
    for (let k = 0; k < SPARE_ROWS; k++) {
      const i = data.length + 2;
      data.push(['', '', branches.length === 1 ? branches[0].name : '', '', '', null, null, null, null, '', null, this.amountFormula(i, ''), '', '', null,
        crypto.randomBytes(6).toString('hex'), '', '', null, null, null, '']);
    }
    ws.addTable({
      name: 'BuyListLines', ref: 'A1', headerRow: true,
      style: { theme: 'TableStyleLight9', showRowStripes: true },
      columns: COLUMNS.map((c) => ({ name: c.header, filterButton: true })),
      rows: data,
    });
    COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
    for (const k of HIDDEN) ws.getColumn(COL[k]).hidden = true;
    ws.getColumn(COL.needed).numFmt = '#,##0.###';
    ws.getColumn(COL.packs).numFmt = '#,##0.###';
    ws.getColumn(COL.packSize).numFmt = '#,##0.###';
    ws.getColumn(COL.pricePerPack).numFmt = '#,##0.00';
    ws.getColumn(COL.amount).numFmt = '#,##0.00';
    const lastRow = data.length + 1;
    const existingRows = data.length - SPARE_ROWS;
    for (let r = 2; r <= lastRow; r++) {
      // Grey is what Clerque fills in. On an existing line, Line No., Branch and Item are Clerque's too.
      const greyKeys: string[] = [...READ_ONLY, ...(r <= existingRows + 1 ? ['lineNumber', 'branch', 'item'] : [])];
      for (const k of greyKeys) {
        ws.getCell(r, COL[k as keyof typeof COL]).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } };
      }
      ws.getCell(r, COL.item).dataValidation = {
        type: 'list', allowBlank: true, showErrorMessage: false,
        // A named range on its own sheet: an inline list longer than 255 characters is dropped by Excel.
        formulae: [`Items!$A$2:$A$${Math.max(2, materials.length + 1)}`],
      };
      ws.getCell(r, COL.boughtOn).numFmt = 'yyyy-mm-dd';
      ws.getCell(r, COL.inStockOn).numFmt = 'yyyy-mm-dd';
    }
    for (const c of COLUMNS) {
      if ((READ_ONLY as readonly string[]).includes(c.key)) {
        ws.getCell(1, COL[c.key]).note = 'Filled in by Clerque. Changing it here changes nothing.';
      }
    }
    ws.getCell(1, COL.lineNumber).note = 'The line\'s control number. Leave it as it is. Leave it BLANK on a row that adds a purchase made away from the app.';
    ws.getCell(1, COL.packSize).note = 'What one pack holds, in the Pack unit (g, kg, ml, L, pcs).';

    // ── Requests ─────────────────────────────────────────────────────────────
    const rs = wb.addWorksheet('Requests', { views: [{ state: 'frozen', ySplit: 1 }] });
    rs.addRow(['Request No.', 'Branch', 'Status', 'Started', 'Sent on', 'Bought on', 'In stock on', 'Paid ahead from', 'Note']).font = { bold: true };
    for (const r of requests) {
      rs.addRow([
        r.requestNumber, r.branch?.name ?? '', REQUEST_WORDS[r.status] ?? r.status, manilaDay(r.createdAt),
        r.sentAt ? manilaDay(r.sentAt) : '', r.boughtAt ? manilaDay(r.boughtAt) : '', r.receivedAt ? manilaDay(r.receivedAt) : '',
        POCKET_WORDS[readTag(r.notes, 'PREPAID') ?? ''] ?? '', plainNotes(r.notes),
      ]);
    }
    [19, 14, 12, 12, 12, 12, 12, 22, 60].forEach((w, i) => { rs.getColumn(i + 1).width = w; });

    // ── Stock on hand (not read back) ───────────────────────────────────────
    const ss = wb.addWorksheet('Stock on hand', { views: [{ state: 'frozen', ySplit: 1 }] });
    ss.addRow(['Branch', 'Item', 'Unit', 'Kind', 'On hand', 'Reorder level']).font = { bold: true };
    for (const b of branches) {
      for (const m of materials) {
        const kind = m.subRecipeItems.length === 0 ? 'Bought'
          : m.bomItems.length > 0 ? 'Ready to use (L1)'
          : m.usedInSubRecipes.length > 0 ? 'Parked (L2)'
          : 'Made in the kitchen';
        const onHand = Number(m.inventory.find((x) => x.branchId === b.id)?.quantity ?? 0);
        ss.addRow([b.name, m.name, m.unit, kind, onHand, m.lowStockAlert != null ? Number(m.lowStockAlert) : null]);
      }
    }
    [14, 30, 7, 20, 12, 13].forEach((w, i) => { ss.getColumn(i + 1).width = w; });
    ss.getColumn(5).numFmt = '#,##0.###';
    ss.getColumn(6).numFmt = '#,##0.###';

    // ── Items: the dropdown's list ───────────────────────────────────────────
    const is = wb.addWorksheet('Items', { state: 'hidden' });
    is.addRow(['Item', 'Unit']);
    for (const m of materials.filter((x) => x.subRecipeItems.length === 0)) is.addRow([m.name, m.unit]);

    // ── How to use ───────────────────────────────────────────────────────────
    const hs = wb.addWorksheet('How to use');
    hs.getColumn(1).width = 110;
    const how = [
      'Buy lists — how to use this file',
      '',
      'This file is a copy of the buy lists in Clerque. Clerque is still where purchases are recorded; the file is the backup.',
      '',
      'To fill in what was bought on a line: in the Lines sheet, type Packs bought, Pack size, Pack unit, Price per pack and Brand / store on its row.',
      'To add something bought away from the app: use a blank row at the bottom. Leave Line No. blank; fill Branch, Item (pick from the list), Bought on (YYYY-MM-DD), packs, pack size, unit and price.',
      'Pack size is what ONE pack holds. 1 in Pack unit L on a millilitre item is read as 1,000 ml. A pack unit like "bottle" cannot be converted and is refused.',
      'Grey cells are filled in by Clerque. Changing them changes nothing.',
      '',
      'Upload the file in Clerque: Procure > Buy lists in Excel. You see what will change, what is new and what is refused (with the row number) before anything is saved.',
      'Nothing goes into stock from the file. Open the request in Clerque and tap Post to stock when the goods are on the shelf.',
      'A line already in stock, or an order paid ahead, cannot be changed from the file. Correct those in Clerque.',
      'Uploading the same file again after fixing packs, pack size or price corrects the purchase; it does not record it twice. To change the date, branch or item of a purchase already recorded, cancel its request in Clerque and upload again.',
      'If something was changed in Clerque after you downloaded this file, that row is refused: download a fresh file and make the change there.',
      'Leave hidden columns alone, and add another purchase in an empty row rather than a copied one.',
    ];
    how.forEach((t, i) => { const row = hs.addRow([t]); if (i === 0) row.font = { bold: true, size: 14 }; });

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, filename: `clerque-buy-lists-${from}-to-${to}.xlsx` };
  }

  private amountFormula(row: number, result: number | string) {
    const h = `${letter(COL.packs)}${row}`, k = `${letter(COL.pricePerPack)}${row}`;
    return { formula: `IF(OR(${h}="",${k}=""),"",${h}*${k})`, result };
  }

  // ── the upload ────────────────────────────────────────────────────────────

  async importWorkbook(
    tenantId: string,
    file: Express.Multer.File | undefined,
    actor: { userId: string; role: string },
    preview: boolean,
  ): Promise<SheetPlanResult> {
    if (!file?.buffer?.length) throw new BadRequestException('Choose the buy-lists Excel file to upload.');
    if (!/\.xlsx$/i.test(file.originalname ?? '')) throw new BadRequestException('Upload the .xlsx file downloaded from Clerque (a CSV loses the columns it needs).');
    const rows = await this.readLines(file.buffer, tenantId);
    if (rows.length === 0) throw new BadRequestException('The Lines sheet has no rows to read.');

    const today = manilaDay(new Date());
    const lineNumbers = [...new Set(rows.map((r) => r.lineNumber.trim()).filter(Boolean))];
    const newDays = [...new Set(rows.filter((r) => !r.lineNumber.trim() && /^\d{4}-\d{2}-\d{2}$/.test(r.boughtOn.trim())).map((r) => r.boughtOn.trim()))];
    const rowKeys = [...new Set(rows.filter((r) => !r.lineNumber.trim()).map((r) => r.rowKey.trim()).filter((k) => /^[0-9a-f]{12}$/.test(k)))];
    const [lineRows, materials, branches] = await Promise.all([
      this.prisma.purchaseRequestLine.findMany({
        where: {
          purchaseRequest: { tenantId },
          OR: [
            { lineNumber: { in: lineNumbers } },
            // Purchases from an earlier upload on the same days: fixing a typo must correct them, not repeat them.
            ...(newDays.length ? [{ purchaseRequest: { notes: { contains: SHEET_MARK }, status: { not: 'CANCELLED' as const }, boughtAt: { in: newDays.map(manilaMidnight) } } }] : []),
            // And by the rows' own keys, whatever their date, branch or item now say.
            ...rowKeys.map((k) => ({ purchaseRequest: { notes: { contains: k }, status: { not: 'CANCELLED' as const } } })),
          ],
        },
        include: {
          rawMaterial: { select: { name: true, unit: true } },
          purchaseRequest: { select: { id: true, requestNumber: true, status: true, notes: true, branchId: true, boughtAt: true, branch: { select: { name: true } } } },
        },
      }),
      this.prisma.rawMaterial.findMany({
        where: { tenantId }, select: { id: true, name: true, unit: true, isActive: true, subRecipeItems: { select: { id: true }, take: 1 } },
      }),
      this.prisma.branch.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
    ]);

    const lines: ExistingLine[] = lineRows.map((l) => ({
      lineId: l.id, lineNumber: l.lineNumber, requestId: l.purchaseRequest.id, requestNumber: l.purchaseRequest.requestNumber,
      requestStatus: l.purchaseRequest.status, prepaid: !!readTag(l.purchaseRequest.notes, 'PREPAID'),
      fromSheet: (l.purchaseRequest.notes ?? '').includes(SHEET_MARK),
      sheetRowKey: rowKeyOf(l.purchaseRequest.notes, l.lineNumber),
      branchId: l.purchaseRequest.branchId, branchName: l.purchaseRequest.branch?.name ?? '',
      rawMaterialId: l.rawMaterialId, itemName: l.rawMaterial.name, unit: l.rawMaterial.unit,
      packsBought: l.packsBought != null ? Number(l.packsBought) : null, packSize: l.packSize != null ? Number(l.packSize) : null,
      packCost: l.packCost != null ? Number(l.packCost) : null, brandNote: l.brandNote,
      boughtOn: l.purchaseRequest.boughtAt ? manilaDay(l.purchaseRequest.boughtAt) : null, receivedAt: l.receivedAt,
    }));
    const verdicts = planBuyListRows({
      rows, lines, branches, today,
      materials: materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, isActive: m.isActive, isPrep: m.subRecipeItems.length > 0 })),
      canAddNew: ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM'].includes(actor.role),
    });
    const counts = {
      unchanged: verdicts.filter((v) => v.kind === 'UNCHANGED').length,
      fill:      verdicts.filter((v) => v.kind === 'FILL').length,
      new:       verdicts.filter((v) => v.kind === 'NEW').length,
      refused:   verdicts.filter((v) => v.kind === 'REFUSED').length,
    };
    const out: SheetPlanResult['rows'] = verdicts.map((v) => ({ ...v }));
    if (preview) return { preview: true, counts, rows: out };

    // ── apply: fills per request, new purchases per branch and day ──────────
    const fills = new Map<string, Array<Extract<PlanVerdict, { kind: 'FILL' }>>>();
    for (const v of verdicts) if (v.kind === 'FILL') fills.set(v.requestId, [...(fills.get(v.requestId) ?? []), v]);
    for (const [requestId, group] of fills) {
      const mark = (applied: 'done' | 'failed', message?: string) => {
        for (const v of group) Object.assign(out.find((o) => o.rowNumber === v.rowNumber)!, { applied, ...(message ? { message } : {}) });
      };
      try {
        await this.procure.recordBought(tenantId, requestId,
          group.map((v) => ({ lineId: v.lineId, packsBought: v.packsBought, packSize: v.packSize, packCost: v.packCost, brandNote: v.brandNote ?? undefined })),
          actor, { boughtAt: group.find((v) => v.boughtOn)?.boughtOn ?? undefined, quiet: true });
        mark('done');
      } catch (err) {
        mark('failed', err instanceof Error ? err.message : 'Could not record these lines.');
      }
    }

    const source = `${file.originalname} · ${crypto.createHash('sha256').update(file.buffer).digest('hex').slice(0, 12)}`;
    const news = new Map<string, Array<Extract<PlanVerdict, { kind: 'NEW' }>>>();
    for (const v of verdicts) if (v.kind === 'NEW') news.set(`${v.branchId}|${v.boughtOn}`, [...(news.get(`${v.branchId}|${v.boughtOn}`) ?? []), v]);
    for (const group of news.values()) {
      const at = (applied: 'done' | 'failed', extra: { message?: string; requestNumber?: string }) => {
        for (const v of group) Object.assign(out.find((o) => o.rowNumber === v.rowNumber)!, { applied, ...extra });
      };
      try {
        const req = await this.procure.recordFromSheet(tenantId, group[0].branchId, group[0].boughtOn,
          group.map((v) => ({ rawMaterialId: v.rawMaterialId, packsBought: v.packsBought, packSize: v.packSize, packCost: v.packCost, brandNote: v.brandNote, rowKey: v.rowKey })),
          actor, `${SHEET_MARK} (${source})`);
        at('done', { requestNumber: req.requestNumber });
      } catch (err) {
        at('failed', { message: err instanceof Error ? err.message : 'Could not record these purchases.' });
      }
    }
    return { preview: false, counts, rows: out };
  }

  /**
   * The Lines sheet, by heading, with each row's real Excel row number.
   * Reading into a plain array would lose the number and skip blank rows, and
   * a refusal that points at the wrong row is worse than none.
   */
  private async readLines(buffer: Buffer, tenantId: string): Promise<SheetRow[]> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as never);
    } catch {
      throw new BadRequestException('That file could not be opened as an Excel workbook.');
    }
    // Control numbers repeat from shop to shop; a file downloaded from another shop must not fill this one's lines.
    const marked = String(wb.keywords ?? '');
    if (marked.startsWith(TENANT_MARK) && marked !== `${TENANT_MARK}${tenantId}`) {
      throw new BadRequestException('This file was downloaded from a different shop. Sign in to that shop to upload it, or download this shop\'s file.');
    }
    const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === 'lines') ?? wb.worksheets[0];
    if (!ws) return [];
    // The heading row: the first of the top five with a "Line No." cell.
    let headerRow = 0;
    for (let r = 1; r <= Math.min(5, ws.rowCount) && !headerRow; r++) {
      ws.getRow(r).eachCell((cell) => { if (text(cell.value).trim().toLowerCase() === 'line no.') headerRow = r; });
    }
    if (!headerRow) throw new BadRequestException('No "Line No." heading in the Lines sheet. Upload the file downloaded from Clerque.');
    const colOf = new Map<string, number>();
    ws.getRow(headerRow).eachCell((cell, c) => colOf.set(text(cell.value).trim().toLowerCase(), c));
    const need = ['line no.', 'item', 'packs bought', 'pack size', 'price per pack (php)'];
    const missing = need.filter((h) => !colOf.has(h));
    if (missing.length) throw new BadRequestException(`The Lines sheet is missing: ${missing.join(', ')}.`);
    const get = (row: ExcelJS.Row, header: string) => { const c = colOf.get(header); return c ? text(row.getCell(c).value) : ''; };
    const hasWas = ['was item', 'was packs', 'was pack size', 'was price'].every((h) => colOf.has(h));
    const rows: SheetRow[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      rows.push({
        rowNumber: r,
        lineNumber: get(row, 'line no.'), branch: get(row, 'branch'), item: get(row, 'item'), boughtOn: get(row, 'bought on'),
        packs: get(row, 'packs bought'), packSize: get(row, 'pack size'), packUnit: get(row, 'pack unit'),
        pricePerPack: get(row, 'price per pack (php)'), brand: get(row, 'brand / store'), rowKey: get(row, 'row key'),
        was: hasWas ? {
          item: get(row, 'was item'), boughtOn: get(row, 'was bought on'), packs: get(row, 'was packs'),
          packSize: get(row, 'was pack size'), pricePerPack: get(row, 'was price'), brand: get(row, 'was brand'),
        } : null,
      });
    }
    return rows;
  }

  private range(from: string, to: string): { from: string; to: string } {
    const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '') && !Number.isNaN(Date.parse(s));
    if (!ok(from) || !ok(to) || from > to) throw new BadRequestException('Give the dates as from=YYYY-MM-DD&to=YYYY-MM-DD, earliest first.');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) throw new BadRequestException('A year at most in one file. Narrow the dates.');
    return { from, to };
  }
}

/** The spare-row key a sheet line was recorded from: the request's note lists "Sheet rows: key=01, key=02". */
function rowKeyOf(notes: string | null, lineNumber: string): string | null {
  const suffix = /-(\d+)$/.exec(lineNumber)?.[1];
  const list = /Sheet rows: ([0-9a-f=, ]+)/.exec(notes ?? '')?.[1];
  if (!suffix || !list) return null;
  for (const pair of list.split(',')) {
    const [k, n] = pair.trim().split('=');
    if (n === suffix && /^[0-9a-f]{12}$/.test(k)) return k;
  }
  return null;
}

const REQUEST_WORDS: Record<string, string> = { OPEN: 'Building', SENT: 'Sent', BOUGHT: 'Bought', RECEIVED: 'In stock', CANCELLED: 'Cancelled' };
const POCKET_WORDS: Record<string, string> = { CASH: 'the till', OWNER_FUNDED: "the owner's own money", BANK: 'the shop bank or GCash' };

function lineStatus(requestStatus: string, l: { receivedAt: Date | null; packsBought: unknown }): string {
  if (l.receivedAt) return l.packsBought != null && Number(l.packsBought) <= 0 ? 'Nothing arrived' : 'In stock';
  if (requestStatus === 'RECEIVED') return 'Back on the list';
  if (requestStatus === 'CANCELLED') return 'Cancelled';
  if (requestStatus === 'OPEN') return 'Not sent yet';
  return l.packsBought == null ? 'Not bought yet' : 'Bought, not in stock';
}

function manilaDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PH_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function manilaMidnight(day: string): Date {
  return new Date(`${day}T00:00:00+08:00`);
}

/** A cell as the plain string a person typed: dates as YYYY-MM-DD, formulas as their value. */
function text(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v !== 'object') return String(v);
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: unknown }>).map((r) => String(r?.text ?? '')).join('');
  if ('formula' in o || 'sharedFormula' in o) return text(o.result);
  if ('hyperlink' in o) return text(o.text);
  if ('error' in o) return '';
  if ('text' in o) return text(o.text);
  return String(v);
}
