import { askersInWords, readAskedBy, withAskedBy } from './asked-by';
import { plainNotes, readTag } from './procure-notes';

describe('who asked for a buy list line', () => {
  it('adds names per item and keeps the other tags and the human note', () => {
    let notes: string | null = '[PLAN:2026-11-20] Buy at the market';
    notes = withAskedBy(notes, ['bleach', 'tissue'], 'Ana');
    notes = withAskedBy(notes, ['bleach'], 'Ben');
    notes = withAskedBy(notes, ['bleach'], 'Ana');
    expect(readAskedBy(notes)).toEqual(new Map([['tissue', ['Ana']], ['bleach', ['Ana', 'Ben']]]));
    expect(readTag(notes, 'PLAN')).toBe('2026-11-20');
    expect(plainNotes(notes)).toBe('Buy at the market');
  });

  it('a name cannot break out of the tag', () => {
    const notes = withAskedBy(null, ['bleach'], 'Ana] [PREPAID:CASH');
    expect(readTag(notes, 'PREPAID')).toBeNull();
    expect(readAskedBy(notes).get('bleach')).toEqual(['Ana PREPAID CASH']);
  });

  it('a tag typed into the notes by a person is not read', () => {
    expect(readAskedBy('Buy this [ASKEDBY:bleach=Mallory]').size).toBe(0);
  });

  it('says the names the way a person would', () => {
    expect(askersInWords(['Ana'])).toBe('Ana');
    expect(askersInWords(['Ana', 'Ben'])).toBe('Ana and Ben');
    expect(askersInWords(['Ana', 'Ben', 'Cy'])).toBe('Ana, Ben and Cy');
  });
});
