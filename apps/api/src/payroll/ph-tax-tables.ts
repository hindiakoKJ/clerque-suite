/**
 * Philippine statutory contribution + withholding tax tables.
 *
 * All amounts in PHP. All employee shares (the ones we actually deduct from
 * the worker's pay) — the employer share is computed for GL posting only,
 * not deducted from net pay.
 *
 * Sources / authority:
 *   - SSS Circular 2022-033 — 14% total (4.5% EE / 9.5% ER) + ₱30 EC for ER,
 *     MSC bands ₱4,000–₱30,000 in ₱500 steps (effective 2023-01).
 *   - PhilHealth Circular 2024-0006 — 5.0% premium, split 50/50, floor
 *     income ₱10,000 → ₱500 EE/ER, cap income ₱100,000 → ₱5,000 EE/ER
 *     (effective 2024-07; we use the EE/ER ₱2,500 cap on ₱100k for now —
 *      legally the cap is now ₱5,000 each on ₱100k, but the rate held at
 *      5% so the cap *income* is what matters).
 *   - Pag-IBIG HDMF Circular 2023-414 — 1% if MMC ≤ ₱1,500 / 2% above,
 *     mandatory monthly compensation cap ₱10,000 → max ₱200 EE / ₱200 ER
 *     (effective 2024-02).
 *   - BIR RR 11-2018 (TRAIN as amended) — withholding tax on compensation,
 *     per-period brackets (Daily/Weekly/Semi-Monthly/Monthly) — taken
 *     directly, NOT by annualizing then dividing.
 *
 * Engine policy:
 *   - We compute period-level deductions from a "monthly equivalent gross"
 *     (period gross × freq factor) only for SSS+PhilHealth+Pag-IBIG, where
 *     the contribution table is published monthly. We then split the
 *     monthly EE share back to the period (×0.5 for semi-monthly, ×7/30
 *     for weekly) — this is the standard convention every PH HRIS uses.
 *   - WHT we use the per-period BIR table directly — that's how BIR
 *     intends it, and avoids the bias from annualize-then-divide.
 */

export type PayFreq = 'WEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY';

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────
// SSS — 2025 Contribution Schedule
// ─────────────────────────────────────────────────────────────────────────────
//
// MSC bands run from ₱4,000 (compensation < ₱4,250) up to ₱30,000
// (compensation ≥ ₱29,750), in ₱500 steps. EE share = MSC × 5%, ER share =
// MSC × 10% + ₱30 EC.
//
// (The schedule changed from 4.5% → 5% EE on 2025-01 per RA 11199 §4 +
// SSS Circular 2024-006. Update this constant if SSS revises again.)

const SSS_EE_RATE = 0.05;  // 2025 employee share rate
const SSS_ER_RATE = 0.10;  // 2025 employer share rate
const SSS_EC_FLAT = 30;    // Employees' Compensation premium — ER only
const SSS_MSC_MIN = 4_000;
const SSS_MSC_MAX = 30_000;
const SSS_MSC_STEP = 500;

/**
 * Map monthly compensation → MSC. The official table buckets compensation
 * by half-step boundaries (e.g. ₱14,750–₱15,249.99 → MSC ₱15,000), but
 * rounding up-to-nearest-₱500 with a centered offset is a clean equivalent
 * to within ±₱1 for any compensation:
 *
 *   bucket = round( (gross - 250) / 500 ) * 500    // centered rounding
 *   MSC    = clamp(bucket, ₱4,000, ₱30,000)
 */
export function sssMsc(monthlyGross: number): number {
  if (monthlyGross < SSS_MSC_MIN + 250) return SSS_MSC_MIN;
  if (monthlyGross >= SSS_MSC_MAX - 250) return SSS_MSC_MAX;
  const bucket = Math.round((monthlyGross - 250) / SSS_MSC_STEP) * SSS_MSC_STEP;
  return Math.max(SSS_MSC_MIN, Math.min(SSS_MSC_MAX, bucket));
}

/** Returns { employee, employer, ec } shares for the given MONTHLY gross. */
export function sssMonthly(monthlyGross: number): { ee: number; er: number; ec: number; msc: number } {
  const msc = sssMsc(monthlyGross);
  return {
    msc,
    ee: round2(msc * SSS_EE_RATE),
    er: round2(msc * SSS_ER_RATE),
    ec: SSS_EC_FLAT,
  };
}

/**
 * SSS — period-level employee deduction. Splits the monthly EE share to
 * the pay-frequency convention used in PH HRIS.
 */
export function computeSssPeriod(monthlyGross: number, freq: PayFreq): number {
  const monthly = sssMonthly(monthlyGross).ee;
  return round2(monthly * freqFactor(freq));
}

// ─────────────────────────────────────────────────────────────────────────────
// PhilHealth — 2024 Premium (5%, split 50/50)
// ─────────────────────────────────────────────────────────────────────────────
//
// Floor income ₱10,000 → premium ₱500/mo (₱250 EE + ₱250 ER)
// Above floor → 5% × monthly gross (still split 50/50)
// Cap income ₱100,000 → premium ₱5,000/mo (₱2,500 EE + ₱2,500 ER)
// (The premium *rate* held at 5% in 2025; we keep the floor/cap referenced
// in the law for clarity.)

const PH_FLOOR_INCOME = 10_000;
const PH_CAP_INCOME   = 100_000;
const PH_RATE         = 0.05;
const PH_FLOOR_EE     = 250;
const PH_CAP_EE       = 2_500;

export function philhealthMonthly(monthlyGross: number): { ee: number; er: number } {
  const capped = Math.min(Math.max(monthlyGross, PH_FLOOR_INCOME), PH_CAP_INCOME);
  const total  = capped * PH_RATE;
  const ee     = Math.max(PH_FLOOR_EE, Math.min(PH_CAP_EE, total / 2));
  return { ee: round2(ee), er: round2(ee) };  // employer matches
}

export function computePhilhealthPeriod(monthlyGross: number, freq: PayFreq): number {
  const monthly = philhealthMonthly(monthlyGross).ee;
  return round2(monthly * freqFactor(freq));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pag-IBIG (HDMF) — 2024
// ─────────────────────────────────────────────────────────────────────────────
//
// Mandatory Monthly Compensation (MMC) capped at ₱10,000 for contribution math.
//   MMC ≤ ₱1,500 → 1% EE / 2% ER
//   MMC >  ₱1,500 → 2% EE / 2% ER
// Employee may opt to contribute more; we don't model voluntary excess yet.

const PAGIBIG_MMC_CAP = 10_000;

export function pagibigMonthly(monthlyGross: number): { ee: number; er: number } {
  const mmc = Math.min(monthlyGross, PAGIBIG_MMC_CAP);
  if (mmc <= 1_500) {
    return { ee: round2(mmc * 0.01), er: round2(mmc * 0.02) };
  }
  return { ee: round2(mmc * 0.02), er: round2(mmc * 0.02) };
}

export function computePagibigPeriod(monthlyGross: number, freq: PayFreq): number {
  const monthly = pagibigMonthly(monthlyGross).ee;
  return round2(monthly * freqFactor(freq));
}

// ─────────────────────────────────────────────────────────────────────────────
// BIR Withholding Tax on Compensation — TRAIN as amended (RR 11-2018,
// effective 2023-01-01 onward — bracket cuts that took effect 2023, kept
// in the 2024 BIR-published per-period tables)
// ─────────────────────────────────────────────────────────────────────────────
//
// Per-period tables (taxable compensation ranges). Each row:
//   [bracketEnd, fixedTax, marginalRate, baseExceeding]
//   tax = fixedTax + (taxable - baseExceeding) * marginalRate
//
// ANNUAL exemption ₱250,000 is baked in: row 0 is "0 tax up to first
// bracket". Use these directly; do NOT annualize-then-divide (introduces
// rounding bias and overstates tax for spiky periods).

interface Bracket {
  upTo:        number; // taxable compensation upper bound (Infinity for top bracket)
  fixedTax:    number;
  marginalRate:number;
  baseExceed:  number; // subtract this from taxable before applying marginalRate
}

// Semi-monthly table — RR 11-2018 (TRAIN tables effective 2023-01-01)
const WHT_SEMI_MONTHLY: Bracket[] = [
  { upTo: 10_417,    fixedTax: 0,        marginalRate: 0.00, baseExceed: 0       },
  { upTo: 16_666,    fixedTax: 0,        marginalRate: 0.15, baseExceed: 10_417  },
  { upTo: 33_332,    fixedTax: 937.50,   marginalRate: 0.20, baseExceed: 16_667  },
  { upTo: 83_332,    fixedTax: 4_270.70, marginalRate: 0.25, baseExceed: 33_333  },
  { upTo: 333_332,   fixedTax: 16_770.70, marginalRate: 0.30, baseExceed: 83_333  },
  { upTo: Infinity,  fixedTax: 91_770.70, marginalRate: 0.35, baseExceed: 333_333 },
];

// Monthly table — RR 11-2018 (TRAIN tables effective 2023-01-01)
const WHT_MONTHLY: Bracket[] = [
  { upTo: 20_833,    fixedTax: 0,         marginalRate: 0.00, baseExceed: 0        },
  { upTo: 33_332,    fixedTax: 0,         marginalRate: 0.15, baseExceed: 20_833   },
  { upTo: 66_666,    fixedTax: 1_875,     marginalRate: 0.20, baseExceed: 33_333   },
  { upTo: 166_666,   fixedTax: 8_541.80,  marginalRate: 0.25, baseExceed: 66_667   },
  { upTo: 666_666,   fixedTax: 33_541.80, marginalRate: 0.30, baseExceed: 166_667  },
  { upTo: Infinity,  fixedTax: 183_541.80,marginalRate: 0.35, baseExceed: 666_667  },
];

// Weekly table — RR 11-2018
const WHT_WEEKLY: Bracket[] = [
  { upTo: 4_808,     fixedTax: 0,        marginalRate: 0.00, baseExceed: 0       },
  { upTo: 7_691,     fixedTax: 0,        marginalRate: 0.15, baseExceed: 4_808   },
  { upTo: 15_384,    fixedTax: 432.60,   marginalRate: 0.20, baseExceed: 7_692   },
  { upTo: 38_461,    fixedTax: 1_971.20, marginalRate: 0.25, baseExceed: 15_385  },
  { upTo: 153_846,   fixedTax: 7_740.45, marginalRate: 0.30, baseExceed: 38_462  },
  { upTo: Infinity,  fixedTax: 42_355.65,marginalRate: 0.35, baseExceed: 153_847 },
];

function tableFor(freq: PayFreq): Bracket[] {
  switch (freq) {
    case 'SEMI_MONTHLY': return WHT_SEMI_MONTHLY;
    case 'MONTHLY':      return WHT_MONTHLY;
    case 'WEEKLY':       return WHT_WEEKLY;
  }
}

/**
 * BIR per-period withholding on TAXABLE compensation. The caller passes
 * the period's taxable gross (i.e. cash compensation MINUS statutory
 * contributions MINUS de-minimis non-taxable allowances). This matches
 * BIR's intent: SSS/PhilHealth/Pag-IBIG EE shares reduce taxable income.
 */
export function computeWithholdingTax(taxablePeriodGross: number, freq: PayFreq): number {
  if (taxablePeriodGross <= 0) return 0;
  const table = tableFor(freq);
  for (const b of table) {
    if (taxablePeriodGross <= b.upTo) {
      const tax = b.fixedTax + (taxablePeriodGross - b.baseExceed) * b.marginalRate;
      return round2(Math.max(0, tax));
    }
  }
  return 0; // unreachable
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Period factor to map a MONTHLY share down to the period level. */
export function freqFactor(freq: PayFreq): number {
  if (freq === 'SEMI_MONTHLY') return 0.5;
  if (freq === 'WEEKLY')       return 7 / 30;
  return 1;
}

/** Annualize a period gross to a monthly equivalent (for SSS/PH/HDMF lookups). */
export function toMonthlyGross(periodGross: number, freq: PayFreq): number {
  if (freq === 'SEMI_MONTHLY') return periodGross * 2;
  if (freq === 'WEEKLY')       return round2(periodGross * (52 / 12));
  return periodGross;
}

/** Period basic pay from salary record. */
export function computeBasicPay(
  rate: number | null, type: string | null,
  regularHours: number, freq: PayFreq,
): number {
  if (!rate || !type) return 0;
  if (type === 'HOURLY') return round2(rate * regularHours);
  if (type === 'DAILY')  return round2((rate / 8) * regularHours);
  if (type === 'MONTHLY') {
    if (freq === 'SEMI_MONTHLY') return round2(rate / 2);
    if (freq === 'WEEKLY')       return round2(rate * 12 / 52);
    return round2(rate);
  }
  if (type === 'SEMI_MONTHLY') {
    if (freq === 'SEMI_MONTHLY') return round2(rate);
    if (freq === 'MONTHLY')      return round2(rate * 2);
    return round2(rate * 2 / (52 / 12));
  }
  return 0;
}

/**
 * One-shot bundle for a single payslip — called by PayrollService.
 *
 * Inputs:
 *   - basicPay     : computed elsewhere (rate × hours, or prorated salary)
 *   - otPay        : overtime premium pay (1.25× × regular hourly × OT hours)
 *   - allowances   : non-taxable de minimis (e.g. rice, transpo) — NOT taxed
 *
 * Outputs:
 *   - { gross, sss, philhealth, pagibig, wht, totalDeductions, net }
 */
export function computePayslip(input: {
  basicPay:    number;
  otPay:       number;
  allowances:  number;     // non-taxable
  freq:        PayFreq;
}): {
  gross:           number;
  sssEe:           number;
  sssEr:           number;
  sssEc:           number;
  philhealthEe:    number;
  philhealthEr:    number;
  pagibigEe:       number;
  pagibigEr:       number;
  withholdingTax:  number;
  totalDeductions: number;
  net:             number;
  taxableGross:    number;
  monthlyEquiv:    number;
} {
  const gross         = round2(input.basicPay + input.otPay + input.allowances);
  const taxableBase   = round2(input.basicPay + input.otPay);   // allowances excluded
  const monthlyEquiv  = toMonthlyGross(taxableBase, input.freq);

  const sss        = sssMonthly(monthlyEquiv);
  const sssEe      = round2(sss.ee * freqFactor(input.freq));
  const sssEr      = round2(sss.er * freqFactor(input.freq));
  const sssEc      = round2(sss.ec * freqFactor(input.freq));

  const ph         = philhealthMonthly(monthlyEquiv);
  const philhealthEe = round2(ph.ee * freqFactor(input.freq));
  const philhealthEr = round2(ph.er * freqFactor(input.freq));

  const pi         = pagibigMonthly(monthlyEquiv);
  const pagibigEe  = round2(pi.ee * freqFactor(input.freq));
  const pagibigEr  = round2(pi.er * freqFactor(input.freq));

  // BIR WHT runs on taxable comp net of statutory EE shares (per BIR rules).
  const taxableGross    = round2(taxableBase - sssEe - philhealthEe - pagibigEe);
  const withholdingTax  = computeWithholdingTax(taxableGross, input.freq);

  const totalDeductions = round2(sssEe + philhealthEe + pagibigEe + withholdingTax);
  const net             = round2(gross - totalDeductions);

  return {
    gross,
    sssEe, sssEr, sssEc,
    philhealthEe, philhealthEr,
    pagibigEe, pagibigEr,
    withholdingTax,
    totalDeductions,
    net,
    taxableGross,
    monthlyEquiv,
  };
}
