import {
  hoursWorked, regularHours, kioskBreakMins, payRunWindow, manilaDayOfWeek, periodsOverlap,
} from './pay-time';
import { computeBasicPay } from './ph-tax-tables';

describe('pay-time', () => {
  it('a 10-hour day with a 1-hour break is 9 hours, 1 of them overtime', () => {
    expect(hoursWorked(600, 60)).toEqual({ grossHours: 9, otHours: 1 });
  });

  it('overtime is paid once: daily ₱800, 9 hours worked, 1 overtime', () => {
    const { grossHours, otHours } = hoursWorked(600, 60);
    const regular = regularHours(grossHours, otHours);
    expect(regular).toBe(8);
    const basic = computeBasicPay(800, 'DAILY', regular, 'SEMI_MONTHLY');
    const otPay = (800 / 8) * otHours * 1.25;
    // 8 × ₱100 + 1 × ₱125 = ₱925 (it was ₱1,025: the overtime hour at 1× plus 1.25×)
    expect(basic + otPay).toBe(925);
  });

  it('kiosk: a punch over 5 hours with no break loses the 60-minute meal period', () => {
    expect(kioskBreakMins(9 * 60)).toBe(60);
    expect(kioskBreakMins(5 * 60)).toBe(0);
    // 07:00–16:00 at the kiosk: 8 hours, no overtime (was 9 with 1 overtime)
    expect(hoursWorked(540, kioskBreakMins(540))).toEqual({ grossHours: 8, otHours: 0 });
  });

  it('a pay run covers whole Manila days, the last day included', () => {
    const { from, to } = payRunWindow(new Date('2026-11-01'), new Date('2026-11-15'));
    expect(from.toISOString()).toBe('2026-10-31T16:00:00.000Z'); // 1 Nov 00:00 Manila
    expect(to.toISOString()).toBe('2026-11-15T16:00:00.000Z');   // 16 Nov 00:00 Manila
    const lastDayEvening = new Date('2026-11-15T11:00:00.000Z');   // 15 Nov 19:00 Manila
    expect(lastDayEvening >= from && lastDayEvening < to).toBe(true);
    const nextRunMorning = new Date('2026-11-16T00:00:00.000Z');   // 16 Nov 08:00 Manila
    expect(nextRunMorning < to).toBe(false);
  });

  it('day of week is taken in Manila time', () => {
    // Sat 14 Nov 2026 23:00 UTC = Sun 15 Nov 07:00 Manila
    expect(manilaDayOfWeek(new Date('2026-11-14T23:00:00.000Z'))).toBe(0);
  });

  it('pay periods that share a day overlap', () => {
    const d = (s: string) => new Date(s);
    expect(periodsOverlap(d('2026-11-01'), d('2026-11-15'), d('2026-11-15'), d('2026-11-30'))).toBe(true);
    expect(periodsOverlap(d('2026-11-01'), d('2026-11-15'), d('2026-11-16'), d('2026-11-30'))).toBe(false);
  });
});
