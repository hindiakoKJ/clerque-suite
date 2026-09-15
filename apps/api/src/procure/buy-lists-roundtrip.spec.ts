import * as ExcelJS from 'exceljs';
import { BuyListsExcelService } from './buy-lists-excel.service';

/**
 * The buy lists out to Excel and back in: the file the owner downloads is the
 * file they can edit and upload, and the upload lands on exactly the lines it
 * came from -- recording only, with the real Excel row number on anything it
 * refuses. The fake database honours the shop and the lookups the service
 * sends, so a dropped tenant filter or a broken re-upload lookup fails here.
 */
describe('buy lists in Excel — out and back in', () => {
  const TENANT = 't1';
  const MAIN = { id: 'b1', name: 'Main' };
  const d = (s: string) => new Date(s);

  const milk = { id: 'rm-milk', name: 'Full Cream Milk', unit: 'ml' };
  const sugar = { id: 'rm-sugar', name: 'White Sugar', unit: 'g' };
  const salt = { id: 'rm-salt', name: 'Salt', unit: 'g' };
  const request = (over: any) => ({ tenantId: TENANT, branchId: MAIN.id, branch: { name: 'Main' }, notes: null, receivedAt: null, ...over });
  const baseRequests = () => [
    request({
      id: 'r1', requestNumber: 'REQ-20260913-001', status: 'SENT',
      createdAt: d('2026-09-13T01:00:00Z'), sentAt: d('2026-09-13T02:00:00Z'), boughtAt: null,
      lines: [
        { id: 'l1', lineNumber: 'REQ-20260913-001-01', rawMaterialId: milk.id, rawMaterial: milk, qtyRequested: 3000, packsBought: null, packSize: null, packCost: null, brandNote: null, receivedAt: null },
        { id: 'l2', lineNumber: 'REQ-20260913-001-02', rawMaterialId: sugar.id, rawMaterial: sugar, qtyRequested: 1000, packsBought: 1, packSize: 1000, packCost: 85, brandNote: null, receivedAt: d('2026-09-13T08:00:00Z') },
      ],
    }),
    request({
      id: 'r2', requestNumber: 'REQ-20260913-002', status: 'BOUGHT', notes: '[PREPAID:BANK] Shopee order',
      createdAt: d('2026-09-13T03:00:00Z'), sentAt: d('2026-09-13T03:00:00Z'), boughtAt: d('2026-09-12T16:00:00Z'),
      lines: [
        { id: 'l3', lineNumber: 'REQ-20260913-002-01', rawMaterialId: salt.id, rawMaterial: salt, qtyRequested: 500, packsBought: 1, packSize: 500, packCost: 20, brandNote: 'Iodized', receivedAt: null },
      ],
    }),
    // Another shop, same control number: must never be read.
    request({
      tenantId: 't2', id: 'rx', requestNumber: 'REQ-20260913-001', status: 'SENT', createdAt: d('2026-09-13T01:00:00Z'), sentAt: null, boughtAt: null,
      lines: [{ id: 'lx', lineNumber: 'REQ-20260913-001-01', rawMaterialId: 'rm-x', rawMaterial: { name: 'Full Cream Milk', unit: 'ml' }, qtyRequested: 1, packsBought: null, packSize: null, packCost: null, brandNote: null, receivedAt: null }],
    }),
  ];
  const MATERIALS = [milk, sugar, salt].map((m) => ({
    ...m, isActive: true, lowStockAlert: 500, subRecipeItems: [], bomItems: [], usedInSubRecipes: [], inventory: [{ branchId: MAIN.id, quantity: 1200 }],
  }));

  function build(opts: { count?: number } = {}) {
    const requests = baseRequests();
    const lineMatches = (r: any, where: any) => {
      const pr = where.purchaseRequest ?? {};
      if (pr.notes?.contains && !(r.notes ?? '').includes(pr.notes.contains)) return false;
      if (pr.status?.not && r.status === pr.status.not) return false;
      if (pr.boughtAt?.in && !(r.boughtAt && pr.boughtAt.in.some((x: Date) => x.getTime() === r.boughtAt.getTime()))) return false;
      return true;
    };
    const prisma: any = {
      purchaseRequest: {
        count: jest.fn().mockResolvedValue(opts.count ?? 2),
        findMany: jest.fn(({ where }: any) => Promise.resolve(requests.filter((r) => r.tenantId === where.tenantId))),
      },
      rawMaterial: { findMany: jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT ? MATERIALS : [])) },
      branch: { findMany: jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT ? [MAIN] : [])) },
      purchaseRequestLine: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(requests
          .filter((r) => r.tenantId === where.purchaseRequest.tenantId)
          .flatMap((r) => r.lines
            .filter((l: any) => where.OR.some((c: any) => (c.lineNumber ? c.lineNumber.in.includes(l.lineNumber) : lineMatches(r, c))))
            .map((l: any) => ({ ...l, purchaseRequest: { id: r.id, requestNumber: r.requestNumber, status: r.status, notes: r.notes, branchId: r.branchId, boughtAt: r.boughtAt, branch: r.branch } }))))),
      },
    };
    const procure: any = {
      resolveBranch: jest.fn((_t: string, id: string) => Promise.resolve(id)),
      recordBought: jest.fn().mockResolvedValue({}),
      // Like the database: the purchase is written as a sheet request, with its rows' keys in the note.
      recordFromSheet: jest.fn((_t: string, branchId: string, day: string, lines: any[], _a: any, note: string) => {
        const requestNumber = `REQ-20260914-00${requests.length}`;
        const keys = lines.map((l, i) => (l.rowKey ? `${l.rowKey}=${String(i + 1).padStart(2, '0')}` : null)).filter(Boolean);
        requests.push(request({
          id: `rs${requests.length}`, requestNumber, status: 'BOUGHT', branchId, createdAt: new Date(), sentAt: new Date(), boughtAt: new Date(`${day}T00:00:00+08:00`),
          notes: `${note}${keys.length ? ` · Sheet rows: ${keys.join(', ')}` : ''}`,
          lines: lines.map((l, i) => ({ id: `ls${i}`, lineNumber: `${requestNumber}-${String(i + 1).padStart(2, '0')}`, rawMaterialId: l.rawMaterialId,
            rawMaterial: MATERIALS.find((m) => m.id === l.rawMaterialId), qtyRequested: l.packsBought * l.packSize, packsBought: l.packsBought, packSize: l.packSize, packCost: l.packCost, brandNote: l.brandNote, receivedAt: null })),
        }));
        return Promise.resolve({ requestNumber });
      }),
    };
    return { svc: new BuyListsExcelService(prisma, procure), prisma, procure, requests };
  }
  const asUpload = (buffer: Buffer, name = 'clerque-buy-lists.xlsx'): any => ({ buffer, originalname: name, size: buffer.length });
  const OWNER = { userId: 'u1', role: 'BUSINESS_OWNER' };

  async function exported() {
    const built = build();
    const out = await built.svc.exportWorkbook(TENANT, { from: '2026-09-01', to: '2026-09-14' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as never);
    return { ...built, out, wb };
  }
  const write = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer());

  it('downloads one row per line with the control number, real numbers, a live amount, and plain sheets', async () => {
    const { out, wb } = await exported();
    expect(out.filename).toBe('clerque-buy-lists-2026-09-01-to-2026-09-14.xlsx');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Lines', 'Requests', 'Stock on hand', 'Items', 'How to use']);
    expect(wb.getWorksheet('Items')!.state).toBe('hidden');
    const ws = wb.getWorksheet('Lines')!;
    expect((ws.getRow(1).values as unknown[]).slice(1, 16)).toEqual([
      'Line No.', 'Request No.', 'Branch', 'Item', 'Unit', 'Needed', 'Bought on', 'Packs bought', 'Pack size', 'Pack unit',
      'Price per pack (PHP)', 'Amount (PHP)', 'Brand / store', 'Status', 'In stock on',
    ]);
    expect(ws.getColumn(16).hidden).toBe(true);                       // the row key and the as-downloaded values
    expect(ws.getCell('A2').value).toBe('REQ-20260913-001-01');       // this shop's line, not the other shop's
    expect(ws.getCell('F2').value).toBe(3000);
    expect(ws.getCell('N2').value).toBe('Not bought yet');
    expect(ws.getCell('N3').value).toBe('In stock');
    expect(ws.getCell('G4').value).toBe('2026-09-13');
    expect(ws.getCell('L4').value).toMatchObject({ formula: 'IF(OR(H4="",K4=""),"",H4*K4)', result: 20 });
    expect(String(ws.getCell('P5').value)).toMatch(/^[0-9a-f]{12}$/);  // a spare row's key
    expect(ws.getCell('D5').dataValidation).toMatchObject({ type: 'list', formulae: ['Items!$A$2:$A$4'] });
    expect((wb.getWorksheet('Requests')!.getRow(3).values as unknown[]).slice(1)).toEqual(['REQ-20260913-002', 'Main', 'Bought', '2026-09-13', '2026-09-13', '2026-09-13', '', 'the shop bank or GCash', 'Shopee order']);
  });

  it('an edited file previews exactly what it would do, by Excel row, and writes nothing', async () => {
    const { svc, wb, procure } = await exported();
    const ws = wb.getWorksheet('Lines')!;
    ws.getCell('H2').value = 3; ws.getCell('I2').value = 1; ws.getCell('J2').value = 'L'; ws.getCell('K2').value = 86.5; ws.getCell('M2').value = 'Emborg';
    ws.getCell('K3').value = 90;       // the sugar already in stock
    ws.getCell('K4').value = 25;       // the paid-ahead salt
    ws.getCell('C6').value = 'Main'; ws.getCell('D6').value = 'White Sugar'; ws.getCell('G6').value = new Date(Date.UTC(2026, 8, 12));
    ws.getCell('H6').value = 2; ws.getCell('I6').value = 1; ws.getCell('J6').value = 'kg'; ws.getCell('K6').value = 80;
    const res = await svc.importWorkbook(TENANT, asUpload(await write(wb)), OWNER, true);
    expect(res.counts).toEqual({ unchanged: 0, fill: 1, new: 1, refused: 2 });
    expect(res.rows.map((r) => [r.rowNumber, r.kind])).toEqual([[2, 'FILL'], [3, 'REFUSED'], [4, 'REFUSED'], [6, 'NEW']]);
    expect(res.rows[0]).toMatchObject({ lineId: 'l1', packsBought: 3, packSize: 1000, packCost: 86.5, brandNote: 'Emborg', unit: 'ml' });
    expect((res.rows[1] as { reason: string }).reason).toMatch(/already in stock/);
    expect((res.rows[2] as { reason: string }).reason).toMatch(/paid ahead/);
    expect(res.rows[3]).toMatchObject({ item: 'White Sugar', boughtOn: '2026-09-12', packSize: 1000, branchId: 'b1', unit: 'g' });
    expect(procure.recordBought).not.toHaveBeenCalled();
    expect(procure.recordFromSheet).not.toHaveBeenCalled();
  });

  it('confirmed, it records the fill and the new purchase -- and the same file again records nothing twice', async () => {
    const { svc, wb, procure } = await exported();
    const ws = wb.getWorksheet('Lines')!;
    ws.getCell('H2').value = 3; ws.getCell('I2').value = 1000; ws.getCell('J2').value = 'ml'; ws.getCell('K2').value = 86.5; ws.getCell('G2').value = '2026-09-13';
    ws.getCell('D6').value = 'White Sugar'; ws.getCell('G6').value = '2026-09-12'; ws.getCell('H6').value = 2; ws.getCell('I6').value = 1000; ws.getCell('J6').value = 'g'; ws.getCell('K6').value = 80;
    const key = String(ws.getCell('P6').value);
    const res = await svc.importWorkbook(TENANT, asUpload(await write(wb)), OWNER, false);

    expect(procure.recordBought).toHaveBeenCalledWith(TENANT, 'r1',
      [{ lineId: 'l1', packsBought: 3, packSize: 1000, packCost: 86.5, brandNote: undefined }], OWNER, { boughtAt: '2026-09-13', quiet: true });
    const [, branchId, day, lines, actor, note] = procure.recordFromSheet.mock.calls[0];
    expect([branchId, day, actor]).toEqual(['b1', '2026-09-12', OWNER]);
    expect(lines).toEqual([{ rawMaterialId: 'rm-sugar', packsBought: 2, packSize: 1000, packCost: 80, brandNote: null, rowKey: key }]);
    expect(note).toMatch(/^Recorded from an Excel upload \(clerque-buy-lists\.xlsx · [0-9a-f]{12}\)$/);
    expect(res.counts).toEqual({ unchanged: 2, fill: 1, new: 1, refused: 0 });
    expect(res.rows.filter((r) => r.kind !== 'UNCHANGED').map((r) => [r.rowNumber, r.applied, r.requestNumber])).toEqual([[2, 'done', undefined], [6, 'done', 'REQ-20260914-003']]);

    // The same file again: the new purchase is found by its row key.
    const again = await svc.importWorkbook(TENANT, asUpload(await write(wb)), OWNER, true);
    expect(again.rows.find((r) => r.rowNumber === 6)?.kind).toBe('UNCHANGED');
    // A typo in its date fixed in the file: refused, not a second purchase.
    ws.getCell('G6').value = '2026-09-11';
    const fixedDate = await svc.importWorkbook(TENANT, asUpload(await write(wb)), OWNER, true);
    expect(fixedDate.rows.find((r) => r.rowNumber === 6)).toMatchObject({ kind: 'REFUSED' });
    expect((fixedDate.rows.find((r) => r.rowNumber === 6) as { reason: string }).reason).toMatch(/^Already recorded as REQ-20260914-003-01: White Sugar at Main, bought 2026-09-12\./);
  });

  it('a row that cannot be recorded says why, and the rest still go through', async () => {
    const { svc, wb, procure } = await exported();
    procure.recordBought.mockRejectedValueOnce(new Error('A request has to be sent before it can be bought against.'));
    const ws = wb.getWorksheet('Lines')!;
    ws.getCell('H2').value = 3; ws.getCell('I2').value = 1000; ws.getCell('K2').value = 86.5;
    ws.getCell('D6').value = 'White Sugar'; ws.getCell('G6').value = '2026-09-12'; ws.getCell('H6').value = 2; ws.getCell('I6').value = 1000; ws.getCell('J6').value = 'g'; ws.getCell('K6').value = 80;
    const res = await svc.importWorkbook(TENANT, asUpload(await write(wb)), OWNER, false);
    expect(res.rows.filter((r) => r.kind !== 'UNCHANGED').map((r) => [r.rowNumber, r.applied, r.message])).toEqual([
      [2, 'failed', 'A request has to be sent before it can be bought against.'],
      [6, 'done', undefined],
    ]);
  });

  it('refuses a file from another shop, a CSV, a file that is not a workbook, and a sheet without its headings', async () => {
    const { svc, out } = await exported();
    await expect(svc.importWorkbook('t2', asUpload(out.buffer), OWNER, true)).rejects.toThrow(/downloaded from a different shop/);
    await expect(svc.importWorkbook(TENANT, asUpload(Buffer.from('a,b'), 'lists.csv'), OWNER, true)).rejects.toThrow(/\.xlsx file/);
    await expect(svc.importWorkbook(TENANT, asUpload(Buffer.from('not a zip')), OWNER, true)).rejects.toThrow(/could not be opened/);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Lines').addRow(['Something', 'Else']);
    await expect(svc.importWorkbook(TENANT, asUpload(await write(wb)), OWNER, true)).rejects.toThrow(/No "Line No." heading/);
  });

  it('refuses a date range that is backwards, longer than a year, or holds more lists than one file carries', async () => {
    const { svc } = build({ count: 2001 });
    await expect(svc.exportWorkbook(TENANT, { from: '2026-09-14', to: '2026-09-01' })).rejects.toThrow(/earliest first/);
    await expect(svc.exportWorkbook(TENANT, { from: '2025-01-01', to: '2026-09-01' })).rejects.toThrow(/A year at most/);
    await expect(svc.exportWorkbook(TENANT, { from: '2026-09-01', to: '2026-09-14' })).rejects.toThrow('2,001 buy lists in these dates; 2,000 at most in one file. Narrow the dates.');
  });
});
