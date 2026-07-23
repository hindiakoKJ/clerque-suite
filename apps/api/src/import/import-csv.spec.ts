import { ImportService } from './import.service';

/**
 * Regression tests for the CSV parser. The previous naive `split(',')`
 * corrupted any file where a quoted field contained a comma (very common in
 * PH product names and addresses) and choked on Excel's UTF-8 BOM.
 */
describe('ImportService — CSV parsing', () => {
  const svc = new ImportService({} as any);
  // parseCsv is private; exercise it directly (same call the importer makes).
  const parse = (text: string): string[][] =>
    (svc as unknown as { parseCsv(t: string): string[][] }).parseCsv(text);

  it('keeps a quoted field that contains a comma in ONE column', () => {
    const rows = parse('Name*,Category,Price*,Cost Price*\n"Pandesal, Large",Bread,10,5');
    expect(rows[1]).toEqual(['Pandesal, Large', 'Bread', '10', '5']);
  });

  it('does not shift later columns when a comma is quoted', () => {
    const rows = parse('Name*,Address\n"Reyes Bakery","123 Main St, Manila"');
    expect(rows[1]).toHaveLength(2);
    expect(rows[1][1]).toBe('123 Main St, Manila');
  });

  it('strips the UTF-8 BOM Excel writes, so the header row still matches', () => {
    const rows = parse('﻿Name*,Price*\nPandesal,10');
    expect(rows[0][0]).toBe('Name*');
  });

  it('handles escaped double quotes inside a field', () => {
    const rows = parse('Name*,Note\n"6"" Cake","He said ""hello"""');
    expect(rows[1][0]).toBe('6" Cake');
    expect(rows[1][1]).toBe('He said "hello"');
  });

  it('handles CRLF line endings', () => {
    const rows = parse('Name*,Price*\r\nPandesal,10\r\n');
    expect(rows).toEqual([['Name*', 'Price*'], ['Pandesal', '10']]);
  });

  it('handles a newline inside a quoted field', () => {
    const rows = parse('Name*,Note\n"Ensaymada","line1\nline2"');
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe('line1\nline2');
  });

  it('drops blank spacer rows but keeps real data', () => {
    const rows = parse('Name*,Price*\n\n   \nPandesal,10\n');
    expect(rows).toEqual([['Name*', 'Price*'], ['Pandesal', '10']]);
  });

  it('keeps empty trailing cells so columns stay aligned', () => {
    const rows = parse('Name*,Category,Price*\nPandesal,,10');
    expect(rows[1]).toEqual(['Pandesal', '', '10']);
  });
});
