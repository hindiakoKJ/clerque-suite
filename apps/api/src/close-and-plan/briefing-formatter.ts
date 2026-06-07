/**
 * ESC/POS formatter for the Morning Briefing print — the one-page sheet
 * the cook reads at 5 AM to know what to bake and which perishables to
 * use first. Replaces "look at the screen" with "look at the wall".
 *
 * Layout target: 58mm thermal (32 chars wide). Fits in any cheap
 * Bluetooth printer the bakery already owns.
 */
import { StickerTier } from '@prisma/client';

const WIDTH = 32;

function pad(label: string, value: string, width: number = WIDTH): string {
  const space = Math.max(1, width - label.length - value.length);
  return `${label}${' '.repeat(space)}${value}`;
}

function center(text: string, width: number = WIDTH): string {
  if (text.length >= width) return text.slice(0, width);
  const padLeft = Math.floor((width - text.length) / 2);
  return ' '.repeat(padLeft) + text;
}

export interface BriefingBakeItem {
  productName:        string;
  recommendedQty:     number;
  unit?:              string;
  reason?:            string; // e.g. "7d avg" or "pre-order"
}

export interface BriefingUseFirstItem {
  rawMaterialName:    string;
  lotCode:            string;
  qtyRemaining:       number;
  unit:               string;
  expirationDate:     Date | null;
  tier:               StickerTier;
}

export interface BriefingPickup {
  time:               string;          // "07:00 AM"
  customerName:       string;
  details:            string;          // "24 pandesal" or "Custom cake balance ₱600"
}

export interface BriefingInput {
  bakeryName:         string;
  date:               Date;            // morning being briefed
  cashier?:           string;          // who's opening (optional)
  bakeList:           BriefingBakeItem[];
  useFirst:           BriefingUseFirstItem[];
  pickups:            BriefingPickup[];
  notes?:             string;          // owner free-text from Close & Plan
}

/**
 * Build a plain-text (human-readable) version of the briefing.
 * This is what shows in the print preview and what gets piped to
 * ESC/POS encoding for actual print. The text-only output is also
 * useful for QA snapshot tests.
 */
export function formatBriefingText(input: BriefingInput): string {
  const lines: string[] = [];
  const dateStr = input.date.toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    weekday:  'short',
    year:     'numeric',
    month:    'short',
    day:      'numeric',
  });

  lines.push('================================');
  lines.push(center('MORNING BRIEFING'));
  lines.push(center(dateStr));
  lines.push('================================');
  lines.push('');
  lines.push(center(input.bakeryName));
  if (input.cashier) lines.push(center(`Opening: ${input.cashier}`));
  lines.push('');

  // ── Bake list ──────────────────────────────────────
  lines.push('--------------------------------');
  lines.push("TODAY'S BAKE LIST");
  lines.push('--------------------------------');
  if (input.bakeList.length === 0) {
    lines.push('  (no scheduled production)');
  } else {
    for (const item of input.bakeList) {
      const qtyStr = `${item.recommendedQty}${item.unit ? ' ' + item.unit : ''}`;
      lines.push(pad('  ' + item.productName, qtyStr));
      if (item.reason) {
        lines.push('    ' + item.reason);
      }
    }
  }
  lines.push('');

  // ── Use First (perishables) ────────────────────────
  lines.push('--------------------------------');
  lines.push('USE FIRST');
  lines.push('--------------------------------');
  const useFirstActive = input.useFirst.filter((u) => u.tier !== StickerTier.NORMAL);
  if (useFirstActive.length === 0) {
    lines.push('  (no perishables flagged)');
  } else {
    for (const item of useFirstActive) {
      const expStr = item.expirationDate
        ? item.expirationDate.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })
        : 'no expiry';
      let prefix = '  ';
      if (item.tier === StickerTier.USE_FIRST)     prefix = '**';
      if (item.tier === StickerTier.EXPIRING_SOON) prefix = '! ';
      if (item.tier === StickerTier.EXPIRED)       prefix = 'XX';
      lines.push(`${prefix}${item.rawMaterialName}`);
      lines.push(`  Lot ${item.lotCode} · exp ${expStr}`);
      lines.push(`  ${item.qtyRemaining} ${item.unit} remaining`);
    }
  }
  lines.push('');

  // ── Pickups ────────────────────────────────────────
  lines.push('--------------------------------');
  lines.push('PICKUPS TODAY');
  lines.push('--------------------------------');
  if (input.pickups.length === 0) {
    lines.push('  (no scheduled pickups)');
  } else {
    for (const p of input.pickups) {
      lines.push(`  ${p.time} ${p.customerName}`);
      lines.push(`    ${p.details}`);
    }
  }
  lines.push('');

  // ── Owner notes ────────────────────────────────────
  if (input.notes && input.notes.trim()) {
    lines.push('--------------------------------');
    lines.push('NOTES FROM OWNER');
    lines.push('--------------------------------');
    // Split long notes across ~30-char lines.
    const note = input.notes.trim();
    const chunks: string[] = [];
    let buf = '';
    for (const word of note.split(/\s+/)) {
      if ((buf + ' ' + word).trim().length > 30) {
        chunks.push(buf.trim());
        buf = word;
      } else {
        buf = (buf + ' ' + word).trim();
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
    for (const c of chunks) lines.push('  ' + c);
    lines.push('');
  }

  lines.push('================================');
  lines.push(center('— END OF BRIEFING —'));
  lines.push('================================');
  lines.push('');
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

/**
 * Build the ESC/POS byte stream for thermal printing. Uses the same
 * EscPosBuilder pattern as Receipt + ZRead — bold for section headers,
 * inverted boxes for USE_FIRST entries (cook reads at-a-glance).
 *
 * Returns Uint8Array; pipe through PrinterService.printRaw() on the
 * Counter mobile, or through any USB ESC/POS bridge from the web.
 */
export function formatBriefingEscPos(
  input: BriefingInput,
  EscPosBuilder: any,
): Uint8Array {
  const b = new EscPosBuilder().init();

  // Header
  b.align('C').bold(true).doubleHeight(true);
  b.line('MORNING BRIEFING');
  b.doubleHeight(false);
  const dateStr = input.date.toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    weekday:  'short',
    month:    'short',
    day:      'numeric',
    year:     'numeric',
  });
  b.line(dateStr);
  b.bold(false);
  b.line(input.bakeryName);
  if (input.cashier) b.line(`Opening: ${input.cashier}`);
  b.feed(1);
  b.align('L').divider('=');

  // Bake list
  b.bold(true).line("TODAY'S BAKE LIST").bold(false);
  b.divider('-');
  if (input.bakeList.length === 0) {
    b.line('  (no scheduled production)');
  } else {
    for (const item of input.bakeList) {
      const qtyStr = `${item.recommendedQty}${item.unit ? ' ' + item.unit : ''}`;
      b.line(pad('  ' + item.productName, qtyStr));
      if (item.reason) b.line('    ' + item.reason);
    }
  }
  b.feed(1);

  // Use First
  b.bold(true).line('USE FIRST').bold(false);
  b.divider('-');
  const useFirstActive = input.useFirst.filter((u) => u.tier !== StickerTier.NORMAL);
  if (useFirstActive.length === 0) {
    b.line('  (no perishables flagged)');
  } else {
    for (const item of useFirstActive) {
      const expStr = item.expirationDate
        ? item.expirationDate.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })
        : 'no expiry';
      if (item.tier === StickerTier.USE_FIRST) {
        b.bold(true).line(`** ${item.rawMaterialName}`).bold(false);
      } else if (item.tier === StickerTier.EXPIRING_SOON) {
        b.line(`!  ${item.rawMaterialName}`);
      } else if (item.tier === StickerTier.EXPIRED) {
        b.bold(true).line(`XX ${item.rawMaterialName} (EXPIRED)`).bold(false);
      } else {
        b.line(`   ${item.rawMaterialName}`);
      }
      b.line(`   Lot ${item.lotCode} · exp ${expStr}`);
      b.line(`   ${item.qtyRemaining} ${item.unit} remaining`);
    }
  }
  b.feed(1);

  // Pickups
  b.bold(true).line('PICKUPS TODAY').bold(false);
  b.divider('-');
  if (input.pickups.length === 0) {
    b.line('  (no scheduled pickups)');
  } else {
    for (const p of input.pickups) {
      b.line(`  ${p.time} ${p.customerName}`);
      b.line(`     ${p.details}`);
    }
  }
  b.feed(1);

  // Notes
  if (input.notes && input.notes.trim()) {
    b.bold(true).line('NOTES FROM OWNER').bold(false);
    b.divider('-');
    const note = input.notes.trim();
    const chunks: string[] = [];
    let buf = '';
    for (const word of note.split(/\s+/)) {
      if ((buf + ' ' + word).trim().length > 30) {
        chunks.push(buf.trim());
        buf = word;
      } else {
        buf = (buf + ' ' + word).trim();
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
    for (const c of chunks) b.line('  ' + c);
    b.feed(1);
  }

  // Footer
  b.align('C').bold(true);
  b.line('— END OF BRIEFING —');
  b.bold(false);
  b.feed(3);
  b.cut();
  return b.build();
}
