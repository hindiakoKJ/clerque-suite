#!/usr/bin/env node
'use strict';
/**
 * Generates the recipe-costing workbook a shop fills in and sends back.
 *
 * WHY THIS EXISTS
 * A shop can always tell you what goes INTO a sauce. What it cannot tell you is
 * what comes OUT of the pot, and what half the ingredients cost -- and without
 * those two numbers the dish cannot be costed at all. Cafe Carolina's Honey
 * Sriracha sells at P150 and costs P0.00 in Clerque today, because both of its
 * ingredients have no price. Five of their seven wing dishes have no chicken in
 * the recipe, so the most expensive thing on the plate is costed at zero.
 *
 * Setting a sub-recipe up in Clerque demands a batch yield nobody has measured,
 * so the honest answer -- "we have never weighed it" -- is the one answer the
 * screen will not take. This workbook asks for the four numbers that are
 * genuinely missing, and computes every number that can be derived from them:
 *
 *     1. what each unpriced ingredient costs, in the pack the shop actually buys
 *     2. what goes into ONE POT of sauce
 *     3. what comes OUT of that pot (measured, once)
 *     4. how much sauce goes on ONE PLATE
 *
 * Servings per pot is never asked for. It is (3) divided by (4), and asking a
 * cook to count plates they have not served yet is asking for a guess.
 *
 * NAMES ARE WRITTEN, NEVER TYPED
 * Every ingredient name comes from the shop's own live rows. A hand-typed name
 * silently creates a SECOND ingredient with its own stock and its own cost:
 * ingredient import matches `name.trim()` case-SENSITIVELY while recipe import
 * matches case-INSENSITIVELY, so the two halves of the same shop disagree about
 * whether a row is new. This tenant already carries "Chicken Wings" beside
 * "Chicken wings", and "parmesan cheese" beside "Parmesan Cheese". Prefilled
 * names are locked and every spare line is a dropdown off the same live list.
 *
 * WHY THE PRICES TAB IS CALLED "Ingredients"
 * parseFile() falls back to the FIRST SHEET when no sheet matches the name it
 * wants (import.service.ts, parseFile). A tab called "1 Prices" would mean an
 * upload silently parses whatever sheet came first -- the instructions page --
 * as ingredient data. The tab therefore carries the exact name the importer
 * looks for, and its headers and hint row are the importer's own, byte for
 * byte, so the file that comes back can be uploaded rather than retyped.
 *
 * WHY RECIPE UNIT IS PREFILLED AND LOCKED
 * The importer writes `unit: storedUnit` on UPDATE as well as create, and never
 * rescales stock already on the shelf. Butter is held in grams; a row reading
 * "Butter | kg | 320" with Recipe Unit left blank flips the stored unit to kg
 * and 4,000 g of butter silently becomes 4,000 kg. Prefilling Recipe Unit with
 * what Clerque holds today makes that branch unreachable.
 *
 * Re-runnable:  node apps/api/scripts/gen-recipe-costing-sheet.js [tenant-slug]
 */


const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');

const SLUG = process.argv[2] || 'carolina-test';
const OUT_DIR = path.resolve(__dirname, '../../../onboarding');

// -- Palette: the same brown and cream every Clerque template is built from ---
const BRAND  = 'FF8B5E3C';
const CREAM  = 'FFF5F1EC';
const WHITE  = 'FFFFFFFF';
const GREY   = 'FF888888';
const INK    = 'FF333333';
const ASK_BG = 'FFFFF6E0';   // a cell somebody has to fill in
const SUM_BG = 'FFEFEAE3';   // a computed total

const MONEY = '#,##0.00';
const FINE  = '#,##0.0000';
const QTY   = '#,##0.###';
const PCT   = '0.0%';

/**
 * Units a shop plausibly BUYS in.
 *
 * Deliberately excludes tsp/tbsp/cup: they are in Clerque's conversion table,
 * but nobody buys a tablespoon of anything, and offering them invites a cook to
 * describe a dose in the column that means a purchase.
 */
const BUY_UNITS = ['g', 'kg', 'ml', 'L', 'pc', 'pack', 'bottle', 'can', 'box', 'sachet', 'tray'];

/** Things you buy by the container. Always allowed; always need a Pack Size. */
const CONTAINERS = ['pc', 'pack', 'bottle', 'can', 'box', 'sachet', 'tray'];

/**
 * The buy units offered against ONE ingredient, given the unit it is held in.
 *
 * Weight and volume never convert into each other -- no density is ever assumed
 * -- so offering "L" against oil held in grams offers a cook a choice that can
 * only end in a rejected row. Restricting the list to the ingredient's own
 * family plus containers makes that mistake unreachable rather than reported:
 * a shop that really does buy oil by the litre says "bottle" and how many grams
 * are in one, which is the only form Clerque can act on anyway.
 */
function buyUnitsFor(storedUnit) {
  const row = UNIT_TABLE.find(function (u) { return u[0] === String(storedUnit || '').toLowerCase(); });
  if (!row) return CONTAINERS.slice();
  const family = row[1];
  const same = UNIT_TABLE
    .filter(function (u) { return u[1] === family && BUY_UNITS.indexOf(u[0]) >= 0; })
    .map(function (u) { return u[0]; });
  // 'L' reads better than 'l' on a dropdown, and normUnit lowercases anyway.
  const pretty = same.map(function (u) { return u === 'l' ? 'L' : u; });
  return pretty.concat(CONTAINERS);
}

/**
 * The conversion table, copied out of apps/api/src/inventory/unit-conversion.ts
 * so the sheet answers exactly what the importer will answer. Only the units a
 * shop can pick above are carried, plus every unit an ingredient may be stored
 * in, because both sides of the comparison have to resolve.
 */
const UNIT_TABLE = [
  ['mg', 'mass', 0.001], ['g', 'mass', 1], ['kg', 'mass', 1000],
  ['oz', 'mass', 28.349523125], ['lb', 'mass', 453.59237],
  ['ml', 'volume', 1], ['cl', 'volume', 10], ['l', 'volume', 1000],
  ['tsp', 'volume', 4.92892159375], ['tbsp', 'volume', 14.78676478125],
  ['cup', 'volume', 240], ['floz', 'volume', 29.5735295625],
  /*
    The spellings normUnit() folds away, carried verbatim.

    normUnit lowercases, strips dots and spaces and drops a trailing "s", so the
    importer happily resolves an ingredient stored as "grams" or "Litre". A
    spreadsheet cannot call normUnit, and a lookup that misses does not fail
    loudly -- it falls through to the container branch and asks for a pack size
    that makes no sense. Carrying the aliases keeps the sheet answering exactly
    what the importer would answer for any shop, not just one whose units happen
    to already be tidy.
  */
  ['gram', 'mass', 1], ['grams', 'mass', 1],
  ['kilo', 'mass', 1000], ['kilogram', 'mass', 1000], ['kilograms', 'mass', 1000],
  ['milliliter', 'volume', 1], ['millilitre', 'volume', 1],
  ['li', 'volume', 1000], ['liter', 'volume', 1000], ['litre', 'volume', 1000],
  ['liters', 'volume', 1000], ['litres', 'volume', 1000],
];

/**
 * The Ingredients importer's own header and hint rows, verbatim.
 *
 * Not decoration. findHeaderRow looks for 'Name*' in the first cell, the first
 * seven columns are then read by POSITION rather than by name, and the hint row
 * is skipped only because its first cell contains the word "required". A
 * reworded header means an upload misses the header row entirely; a reworded
 * hint means the guidance itself is filed as an ingredient.
 *
 * recipe-costing-sheet.spec.ts asserts these still equal what
 * ImportService.ingredientsTemplate() ships, so the two cannot drift apart.
 */
const IMPORTER_HEADERS = [
  'Name*', 'Unit*', 'Cost per Unit (₱)*', 'Low Stock Alert', 'Notes',
  'Recipe Unit', 'Pack Size', 'Category',
];
const IMPORTER_HINTS = [
  'Required. Unique within tenant.',
  'Required. How you BUY it: L / kg / carton / pc / bottle.',
  'REQUIRED. Price of ONE of the unit above. Do not pre-divide.',
  'Optional. Stock-low threshold, in Recipe Units.',
  'Optional. Free text.',
  'Optional. How a RECIPE uses it: ml / g / pc. Blank = same as Unit.',
  'Only for containers. How many Recipe Units in one Unit.',
  'Optional. Ingredient / Kitchen Supply / Bar Supply / Office Supply. Blank = Ingredient.',
];
/** The one column this sheet adds. Safe: the importer never reads past Category. */
const EXTRA_HEADER = 'What that works out to (₱ per recipe unit)';
const EXTRA_HINT   = 'Worked out for you. Leave this one alone.';
const CHECK_HEADER = 'Check';
const CHECK_HINT   = 'Speaks up if a price looks like it belongs to a different size.';

/** The live-name dropdown range, sized once the ingredient count is known. */
let LIST_RANGE = '';

/** Spare blank lines under every prefilled block, for what we did not predict. */
const SPARE_LINES = 6;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function load(prisma) {
  const url = process.env.DATABASE_URL || '';
  if (!/@localhost[:/]/.test(url)) {
    throw new Error('REFUSING: DATABASE_URL is not a localhost database.');
  }

  const tenant = await prisma.tenant.findFirst({
    where: { slug: SLUG },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) throw new Error('No tenant with slug "' + SLUG + '".');

  const materials = await prisma.rawMaterial.findMany({
    where: { tenantId: tenant.id, isActive: true },
    select: {
      id: true, name: true, unit: true, costPrice: true, batchYield: true,
      subRecipeItems: {
        select: { quantity: true, rawMaterial: { select: { id: true, name: true, unit: true } } },
      },
      bomItems: { select: { product: { select: { name: true } } } },
      usedInSubRecipes: { select: { parent: { select: { name: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  /*
    An ingredient with no price is the whole reason this file exists, so it
    decides what goes into it: the sheets are built from the dishes that touch
    one. Nothing about this shop is hardcoded -- a bakery with three unpriced
    ingredients gets a three-row Ingredients tab and the dishes that use them.
  */
  const unpriced = materials.filter((m) => !(Number(m.costPrice) > 0));
  const unpricedIds = new Set(unpriced.map((m) => m.id));

  const dishes = await prisma.product.findMany({
    where: {
      tenantId: tenant.id, isActive: true,
      bomItems: { some: { rawMaterialId: { in: [...unpricedIds] } } },
    },
    select: {
      name: true, price: true,
      bomItems: {
        select: {
          quantity: true,
          rawMaterial: {
            select: {
              id: true, name: true, unit: true, costPrice: true,
              subRecipeItems: { select: { id: true } },
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  /* Preps that already exist and still carry an unpriced component. Their
     amounts are real PER-POT numbers, unlike a dish recipe's per-plate ones. */
  const preps = materials.filter(
    (m) => m.subRecipeItems.length > 0
      && m.subRecipeItems.some((l) => unpricedIds.has(l.rawMaterial.id)),
  );

  /* Names that differ only by case already exist in this tenant and are the
     exact failure this workbook is built to avoid, so they get called out
     rather than quietly asked to be priced twice. */
  const byLower = new Map();
  for (const m of materials) {
    const k = m.name.trim().toLowerCase();
    if (!byLower.has(k)) byLower.set(k, []);
    byLower.get(k).push(m);
  }
  const collisions = new Map();
  for (const [, group] of byLower) {
    if (group.length < 2) continue;
    for (const m of group) {
      collisions.set(m.id, group.filter((o) => o.id !== m.id).map((o) => o.name));
    }
  }

  return { tenant, materials, unpriced, unpricedIds, dishes, preps, collisions };
}

// ---------------------------------------------------------------------------
// Sheet-building helpers, so every sheet reads as the same document
// ---------------------------------------------------------------------------

function titleRow(ws, r, text, span) {
  ws.mergeCells(r, 1, r, span);
  const c = ws.getCell(r, 1);
  c.value = text;
  c.font = { bold: true, size: 14, color: { argb: BRAND } };
  c.alignment = { vertical: 'middle' };
  ws.getRow(r).height = 24;
}

function noteRow(ws, r, text, span, opts) {
  opts = opts || {};
  ws.mergeCells(r, 1, r, span);
  const c = ws.getCell(r, 1);
  c.value = text;
  c.font = { italic: !opts.bold, bold: !!opts.bold, size: opts.size || 10,
             color: { argb: opts.color || 'FF666666' } };
  c.alignment = { wrapText: true, vertical: 'top' };
  if (opts.height) ws.getRow(r).height = opts.height;
}

/**
 * A coloured band across a row, without merging it.
 *
 * Merged cells inside a data grid are the most common reason Excel for Android
 * and Sheets mobile refuse to let someone type in a neighbouring cell, and this
 * workbook is likely to be filled in on a phone. Filling each cell gives the
 * same band with none of that risk. The instruction rows at the very top of a
 * sheet keep their merge -- every Clerque template already merges those, they
 * sit above the frozen header, and nobody types in them.
 */
function bandRow(ws, r, text, span, opts) {
  opts = opts || {};
  for (let c = 1; c <= span; c++) {
    const cell = ws.getCell(r, c);
    if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  }
  const c = ws.getCell(r, 1);
  c.value = text;
  c.font = { bold: !!opts.bold, italic: !!opts.italic, size: opts.size || 10,
             color: { argb: opts.color || INK } };
  c.alignment = { vertical: 'middle' };
  if (opts.height) ws.getRow(r).height = opts.height;
}

function headerRow(ws, r, headers) {
  const row = ws.getRow(r);
  row.values = headers;
  row.font = { bold: true, color: { argb: WHITE }, size: 10 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  row.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  row.height = 32;
}

function hintRow(ws, r, hints) {
  const row = ws.getRow(r);
  row.values = hints;
  row.font = { italic: true, size: 9, color: { argb: GREY } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } };
  row.alignment = { wrapText: true, vertical: 'top' };
  row.height = 34;
}

/** A cell somebody has to fill in: unlocked, tinted, obvious. */
function ask(ws, r, col, opts) {
  opts = opts || {};
  const c = ws.getCell(r, col);
  c.protection = { locked: false };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ASK_BG } };
  const hair = { style: 'hair', color: { argb: 'FFD8C9B4' } };
  c.border = { top: hair, left: hair, bottom: hair, right: hair };
  c.font = { size: 10, color: { argb: INK } };
  if (opts.numFmt) c.numFmt = opts.numFmt;
  if (opts.value != null) c.value = opts.value;
  if (opts.list) {
    c.dataValidation = {
      type: 'list', allowBlank: true, formulae: [opts.list],
      showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Not on the list',
      error: 'Pick a name from the dropdown so it matches what Clerque already has. '
        + 'A typed name that differs by one letter becomes a second ingredient.',
    };
  }
  return c;
}

/** A cell we already know: locked, quiet. */
function known(ws, r, col, value, opts) {
  opts = opts || {};
  const c = ws.getCell(r, col);
  c.value = value;
  c.font = { size: 10, color: { argb: opts.color || INK },
             italic: !!opts.italic, bold: !!opts.bold };
  if (opts.numFmt) c.numFmt = opts.numFmt;
  if (opts.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  if (opts.wrap) c.alignment = { wrapText: true, vertical: 'top' };
  return c;
}

/**
 * A computed cell: the formula AND what it works out to right now.
 *
 * exceljs writes a bare <f> with no cached <v> unless a result is supplied, and
 * a reader that does not calculate -- Google Drive preview, a phone, Excel's
 * Protected View -- then shows an empty cell. A workbook whose whole purpose is
 * to show computed answers must not look blank to the person it was emailed to.
 *
 * Only pre-2007 worksheet functions are used anywhere in this file. exceljs
 * 4.4.0 writes function names verbatim and never adds the `_xlfn.` prefix OOXML
 * requires, so IFS / LET / TEXTJOIN / XLOOKUP would ship as #NAME? errors.
 */
function calc(ws, r, col, formula, result, opts) {
  opts = opts || {};
  const c = ws.getCell(r, col);
  c.value = { formula: formula, result: result == null ? '' : result };
  c.numFmt = opts.numFmt || MONEY;
  c.font = { size: 10, bold: !!opts.bold, color: { argb: opts.color || INK } };
  if (opts.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  return c;
}

/** 1 -> A, 27 -> AA. */
function A1(col) {
  let s = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

const numOf = (v) => (v == null ? 0 : Number(v));

/**
 * Lock everything that is not an input, but leave the sheet usable.
 *
 * The option booleans do not mean what their names suggest -- exceljs emits the
 * OOXML attribute only for a truthy value, and in OOXML the attribute means
 * "this action is NOT protected". Passing true is therefore how a thing is
 * ALLOWED. Verified by reading the emitted sheetProtection element rather than
 * trusting the names.
 */
async function lockDown(ws) {
  await ws.protect('', {
    selectLockedCells: true, selectUnlockedCells: true,
    formatCells: true, formatColumns: true, formatRows: true,
    insertRows: true, sort: true, autoFilter: true,
  });
}


// ---------------------------------------------------------------------------
// Lists -- the hidden sheet every dropdown and every price lookup reads from
// ---------------------------------------------------------------------------

/**
 * The shop's live ingredient names, each with what one recipe unit of it costs.
 *
 * Two kinds of row. An ingredient that already has a price carries that price
 * as a plain number. An ingredient that does not carries a reference to the
 * Ingredients tab, so the moment somebody types what a kilo of butter costs,
 * every sauce that uses butter recosts itself. That reference is guarded with
 * ISNUMBER, because the same cell answers "How many g in one pack?" when it
 * cannot work the conversion out, and a sauce must not multiply a sentence.
 */
function buildLists(ws, data, priceRowById) {
  ws.getCell(1, 1).value = 'Ingredient';
  ws.getCell(1, 2).value = 'Cost per recipe unit';
  ws.getCell(1, 3).value = 'Recipe unit';
  ws.getCell(1, 5).value = 'unit';
  ws.getCell(1, 6).value = 'family';
  ws.getCell(1, 7).value = 'perBase';
  ws.getRow(1).font = { bold: true, size: 10 };

  data.materials.forEach(function (m, i) {
    const r = i + 2;
    ws.getCell(r, 1).value = m.name;
    const priceRow = priceRowById.get(m.id);
    if (priceRow) {
      const ref = 'Ingredients!$I$' + priceRow;
      ws.getCell(r, 2).value = { formula: 'IF(ISNUMBER(' + ref + '),' + ref + ',0)', result: 0 };
    } else {
      ws.getCell(r, 2).value = numOf(m.costPrice);
    }
    ws.getCell(r, 2).numFmt = FINE;
    ws.getCell(r, 3).value = m.unit;
  });

  // The conversion table, so a formula can ask whether kg and g are the same
  // kind of measurement without that answer being baked into the formula.
  UNIT_TABLE.forEach(function (u, i) {
    ws.getCell(i + 2, 5).value = u[0];
    ws.getCell(i + 2, 6).value = u[1];
    ws.getCell(i + 2, 7).value = u[2];
  });

  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 20;
  ws.state = 'hidden';
}

// ---------------------------------------------------------------------------
// Ingredients -- the prices tab, wearing the importer's own headers
// ---------------------------------------------------------------------------

function buildPrices(ws, data) {
  const SPAN = 10;
  let r = 1;
  titleRow(ws, r++, 'What these cost - ' + data.tenant.name, SPAN);
  noteRow(ws, r++, 'These ' + data.unpriced.length + ' ingredients have no price in Clerque, so every dish '
    + 'that uses one is costed as if it were free. Nothing else in this file works until they are filled in.',
    SPAN, { height: 30 });
  noteRow(ws, r++, 'Write the price of ONE of whatever you BUY - one kilo, one bottle, one pack. Do not divide '
    + 'it down yourself; the last column does that. If you buy it in a container (a pack, a bottle, a can), '
    + 'also say how many grams or millilitres are inside one, under Pack Size.', SPAN, { height: 34 });
  noteRow(ws, r++, 'Only the shaded cells are yours. The name and the Recipe Unit are what Clerque already '
    + 'holds - changing either one would create a second copy of the ingredient.', SPAN, { height: 26 });
  r++;

  /*
    Byte-for-byte the importer's own header and hint rows.

    findHeaderRow looks for 'Name*' in the first cell, the first seven columns
    are read by POSITION rather than by name, and the hint row is skipped only
    because its first cell contains the word "required". Reword any of that and
    an upload either misses the header entirely or files the guidance itself as
    an ingredient called "Required. Unique within tenant."

    The ninth column is safe to add: the importer destructures the first seven
    and finds Category by header, so anything past it is never read.
  */
  const headerAt = r;
  headerRow(ws, r++, IMPORTER_HEADERS.concat([EXTRA_HEADER, CHECK_HEADER]));
  hintRow(ws, r++, IMPORTER_HINTS.concat([EXTRA_HINT, CHECK_HINT]));

  const rowById = new Map();

  data.unpriced.forEach(function (m) {
    const used = []
      .concat(m.bomItems.map(function (b) { return b.product.name; }))
      .concat(m.usedInSubRecipes.map(function (s) { return s.parent.name; }));
    const twin = data.collisions.get(m.id);

    known(ws, r, 1, m.name, { bold: true });
    ask(ws, r, 2, { list: '"' + buyUnitsFor(m.unit).join(',') + '"' });
    ask(ws, r, 3, { numFmt: MONEY });
    ask(ws, r, 4, { numFmt: QTY });
    known(ws, r, 5,
      twin && twin.length
        ? 'Looks like a duplicate of "' + twin[0] + '", which already has a price. '
          + 'Probably delete this one rather than price the same thing twice.'
        : (used.length ? 'Used in: ' + used.join(', ') : 'Not used in any recipe yet.'),
      { italic: true, color: twin && twin.length ? 'FFB4341F' : GREY, wrap: true });
    // Prefilled and locked on purpose: see the header comment. Left blank, an
    // upload overwrites the stored unit and strands the stock already counted.
    known(ws, r, 6, m.unit, { color: GREY });
    ask(ws, r, 7, { numFmt: QTY });
    known(ws, r, 8, '');

    /*
      The same decision resolveBuyUnit() makes, in the same order:

        Unit and Recipe Unit the same     -> the price stands
        Convertible outright (kg -> g)    -> divide by the factor, and REFUSE a
                                             Pack Size, because the importer
                                             rejects a row that gives both
        A container (pack, bottle, can)   -> divide by the Pack Size
        Neither                           -> name the number that is missing

      Pre-2007 worksheet functions only. exceljs 4.4.0 writes function names
      verbatim and never adds the `_xlfn.` prefix OOXML requires, so IFS or LET
      would ship as #NAME? down the whole column.
    */
    const famBuy = 'IFERROR(VLOOKUP(LOWER($B' + r + '),Lists!$E:$G,2,FALSE),"?buy")';
    const famRec = 'IFERROR(VLOOKUP(LOWER($F' + r + '),Lists!$E:$G,2,FALSE),"?rec")';
    const perBuy = 'VLOOKUP(LOWER($B' + r + '),Lists!$E:$G,3,FALSE)';
    const perRec = 'VLOOKUP(LOWER($F' + r + '),Lists!$E:$G,3,FALSE)';
    const f =
      'IF($C' + r + '="","",'
      + 'IF(NOT(ISNUMBER($C' + r + ')),"Type just the number",'
      + 'IF($B' + r + '="","Which unit do you buy it in?",'
      + 'IF(EXACT(LOWER($B' + r + '),LOWER($F' + r + ')),$C' + r + ','
      + 'IF(' + famBuy + '=' + famRec + ','
      + 'IF($G' + r + '<>"","Leave Pack Size blank",'
      + '$C' + r + '/(' + perBuy + '/' + perRec + ')),'
      + 'IF(AND(ISNUMBER($G' + r + '),$G' + r + '>0),$C' + r + '/$G' + r + ','
      + '"How many "&$F' + r + '&" in one "&$B' + r + '&"?")'
      + ')))))';
    calc(ws, r, 9, f, '', { numFmt: FINE });

    /*
      The one wrong answer that still looks right.

      Every other mistake is caught: the dropdown rules out a unit that cannot
      convert, and the cost column names the missing Pack Size. What survives is
      a shop that picks "g" -- correctly, it is how the ingredient is held --
      and then types the price of the KILO into it. P85 a gram passes every
      check and overstates the sauce a thousandfold. Nothing but the size of the
      number gives it away, so the sheet asks about the size of the number.
    */
    calc(ws, r, 10,
      'IF(NOT(ISNUMBER($C' + r + ')),"",'
      + 'IF(AND(OR(EXACT(LOWER($B' + r + '),"g"),EXACT(LOWER($B' + r + '),"ml")),$C' + r + '>20),'
      + '"That is ₱"&TEXT($C' + r + ',"0.00")&" for ONE "&$B' + r + '&". Did you mean one kilo, or one litre?",""))',
      '', { numFmt: '@', color: 'FFB4341F' });

    rowById.set(m.id, r);
    r++;
  });

  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 11;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 14;
  ws.getColumn(5).width = 46;
  ws.getColumn(6).width = 13;
  ws.getColumn(7).width = 11;
  ws.getColumn(8).width = 12;
  ws.getColumn(9).width = 26;
  ws.getColumn(10).width = 44;
  ws.views = [{ state: 'frozen', ySplit: headerAt + 1 }];

  return rowById;
}

// ---------------------------------------------------------------------------
// Sauce Batches -- what goes into one pot, and what comes out of it
// ---------------------------------------------------------------------------

/**
 * One block per sauce. Returns, for each, the cells the plate sheet needs.
 *
 * The amounts already on file are shown but never summed. A dish recipe holds
 * PER-PLATE amounts -- 44 g of ketchup on one plate of BBQ wings -- and a pot
 * holds twenty plates' worth, so treating the two as the same number would be
 * wrong by whatever the batch size turns out to be. Showing them anyway is what
 * makes the sheet fillable: the cook reads "44 g on a plate today" and writes
 * the pot amount beside it, instead of facing an empty grid.
 *
 * Nothing here asks how many servings a pot makes. That is the pot divided by
 * what goes on a plate, and both of those are numbers a cook can actually
 * measure.
 */
function buildBatches(ws, data) {
  const SPAN = 5;
  const outUnits = '"ml,g,kg,L,pc"';
  const refs = [];
  let r = 1;

  titleRow(ws, r++, 'One pot at a time - ' + data.tenant.name, SPAN);
  noteRow(ws, r++, 'For each sauce: write what goes into ONE POT, then weigh or measure what comes out. '
    + 'That second number is the one nobody has, and it is the one that decides what the sauce costs - '
    + 'cost per millilitre is simply what went in, divided by what came out.', SPAN, { height: 34 });
  noteRow(ws, r++, 'You only have to measure the pot ONCE. If the next pot comes out different, tell us and '
    + 'we will change it.', SPAN, { height: 20 });
  r++;

  const blocks = []
    .concat(data.preps.map(function (m) {
      return {
        name: m.name, kind: 'prep', unit: m.unit,
        yieldNow: m.batchYield == null ? null : numOf(m.batchYield),
        lines: m.subRecipeItems.map(function (l) {
          return { name: l.rawMaterial.name, qty: numOf(l.quantity) };
        }),
      };
    }))
    .concat(data.dishes.map(function (d) {
      const main = mainItemOf(d);
      return {
        name: d.name, kind: 'dish', unit: null, yieldNow: null,
        lines: d.bomItems
          // The main item is asked for once, on the plate sheet. Listing it
          // here too invites a pot amount against it and a plate amount for the
          // same chicken, and the sheet would add both.
          .filter(function (b) { return !main || b.rawMaterial.name !== main.name; })
          .map(function (b) { return { name: b.rawMaterial.name, qty: numOf(b.quantity) }; })
          .sort(function (a, b) { return a.name.localeCompare(b.name); }),
      };
    }));

  blocks.forEach(function (blk) {
    const perWhat = blk.kind === 'prep' ? 'per pot' : 'per plate';

    bandRow(ws, r++, (blk.kind === 'prep' ? 'PREP: ' : 'SAUCE FOR: ') + blk.name, SPAN,
      { bold: true, size: 12, color: WHITE, fill: BRAND, height: 22 });

    bandRow(ws, r++, blk.kind === 'prep'
      ? 'Clerque already holds this as a prep' + (blk.yieldNow ? ', assuming one batch makes '
          + blk.yieldNow.toLocaleString('en-PH') + ' ' + blk.unit + ' - nobody has checked that number against a jug.' : '.')
      : 'The amounts below are what the recipe says goes on ONE PLATE. Write the POT amounts beside them. '
        + 'Leave the pot column blank for anything that is not part of the sauce, like the chicken itself.',
      SPAN, { italic: true, color: 'FF666666', height: 18 });

    const headAt = r;
    headerRow(ws, r++, ['Ingredient', 'Unit', 'Your recipe today (' + perWhat + ')',
                        'Goes into ONE POT', '₱ this costs']);

    const firstLine = r;
    const drawLine = function (name, qty) {
      if (name) {
        known(ws, r, 1, name, {});
      } else {
        ask(ws, r, 1, { list: LIST_RANGE });
      }
      /*
        The spare lines are where a name gets TYPED, and a typed name is the one
        way this workbook can still corrupt the shop's costing. The dropdown
        prevents it, but data validation is the first thing a phone editor or
        WPS drops on a round trip -- so the unit column doubles as the detector.
        A name matching nothing in the shop says so, loudly, instead of shrugging
        with a question mark that reads like a formatting quirk.
      */
      calc(ws, r, 2,
        'IF($A' + r + '="","",IFERROR(VLOOKUP($A' + r + ',Lists!$A:$C,3,FALSE),"NOT ON THE LIST"))',
        name ? (lookupUnit(data, name) || 'NOT ON THE LIST') : '', { numFmt: '@' });
      if (qty != null) known(ws, r, 3, qty, { numFmt: QTY, color: GREY, italic: true });
      else known(ws, r, 3, '');
      ask(ws, r, 4, { numFmt: QTY });
      calc(ws, r, 5,
        'IF(OR($A' + r + '="",NOT(ISNUMBER($D' + r + '))),"",'
        + 'IFERROR($D' + r + '*VLOOKUP($A' + r + ',Lists!$A:$B,2,FALSE),""))', '');
      r++;
    };

    blk.lines.forEach(function (l) { drawLine(l.name, l.qty); });
    for (let i = 0; i < SPARE_LINES; i++) drawLine(null, null);
    const lastLine = r - 1;

    const totalAt = r;
    known(ws, r, 1, 'TOTAL that goes into the pot', { bold: true, fill: SUM_BG });
    known(ws, r, 2, '', { fill: SUM_BG });
    known(ws, r, 3, '', { fill: SUM_BG });
    known(ws, r, 4, '', { fill: SUM_BG });
    calc(ws, r, 5, 'SUM($E$' + firstLine + ':$E$' + lastLine + ')', 0,
      { bold: true, fill: SUM_BG });
    r++;

    const outAt = r;
    known(ws, r, 1, 'How much comes OUT of the pot  <- measure this once', { bold: true });
    if (blk.kind === 'prep') known(ws, r, 2, blk.unit, { color: GREY });
    else ask(ws, r, 2, { list: outUnits });
    known(ws, r, 3, '');
    ask(ws, r, 4, { numFmt: QTY });
    known(ws, r, 5, '');
    r++;

    const costAt = r;
    known(ws, r, 1, 'So ONE unit of this sauce costs', { bold: true, fill: SUM_BG });
    known(ws, r, 2, '', { fill: SUM_BG });
    known(ws, r, 3, '', { fill: SUM_BG });
    known(ws, r, 4, '', { fill: SUM_BG });
    calc(ws, r, 5,
      'IF(OR(NOT(ISNUMBER($D$' + outAt + ')),$D$' + outAt + '<=0),"",$E$' + totalAt + '/$D$' + outAt + ')',
      '', { bold: true, numFmt: FINE, fill: SUM_BG });
    r++;
    r++;

    refs.push({ name: blk.name, kind: blk.kind, outAt: outAt, costAt: costAt,
                firstLine: firstLine, lastLine: lastLine });
  });

  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 8;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 16;
  return refs;
}

/**
 * The thing the plate is actually made of, when the recipe already says so.
 *
 * Counted in pieces is the honest signal -- seasoning is weighed, meat is
 * counted -- and picking by line cost alone would nominate 40 ml of Knorr as
 * the main item of Garlic Chicken. Null asks the question rather than answering
 * it wrongly.
 *
 * Shared by both sheets deliberately: whatever is named here is kept OUT of the
 * pot block, because the same chicken costed once in the pot and once on the
 * plate is the one arithmetic error this workbook could still make on its own.
 */
function mainItemOf(dish) {
  let best = null;
  dish.bomItems.forEach(function (b) {
    if (String(b.rawMaterial.unit).toLowerCase() !== 'pc') return;
    if (!(Number(b.rawMaterial.costPrice) > 0)) return;
    const line = numOf(b.quantity) * Number(b.rawMaterial.costPrice);
    if (!best || line > best.line) {
      best = { name: b.rawMaterial.name, qty: numOf(b.quantity), line: line };
    }
  });
  return best;
}

function lookupUnit(data, name) {
  const m = data.materials.find(function (x) { return x.name === name; });
  return m ? m.unit : null;
}

// ---------------------------------------------------------------------------
// On the Plate -- the two numbers that turn a pot into a plate
// ---------------------------------------------------------------------------

function buildPlate(ws, data, refs) {
  const SPAN = 16;
  let r = 1;
  titleRow(ws, r++, 'What one plate costs - ' + data.tenant.name, SPAN);
  noteRow(ws, r++, 'Two numbers per dish: how much sauce goes on one plate, and how much chicken. '
    + 'Everything to the right of them works itself out - including how many plates one pot makes, '
    + 'which is why nobody is asked to count servings.', SPAN, { height: 30 });
  noteRow(ws, r++, 'If measuring a ladle is awkward, answer the other one instead: how many plates does '
    + 'ONE POT do? Ilang plato ang kaya ng isang kaldero? Either answer gives the same result, and you only '
    + 'need one of the two.', SPAN, { height: 30 });
  noteRow(ws, r++, 'The main item is whatever the plate is actually made of. Five of these dishes have no '
    + 'chicken in the recipe at all today, which is why they look almost free to make.', SPAN, { height: 26 });
  r++;

  const headAt = r;
  headerRow(ws, r++, ['Dish', 'Sells for ₱',
                      'Sauce on one plate', 'unit',
                      '...or plates from one pot',
                      '→ sauce per plate used',
                      'Main item (the meat)', 'How much on one plate', 'unit',
                      '→ sauce costs', '→ main item costs', '→ COST PER PLATE',
                      '→ you keep', '→ margin', '→ plates per pot', 'Check']);
  hintRow(ws, r++, ['', 'What it sells for now.',
                    'Ilang gramo o ml sa isang plato? Measure the ladle once.', '',
                    'Ilang plato ang kaya ng isang kaldero? Answer this OR the one on the left.',
                    'Whichever of the two you answered.',
                    'Pick from the list.', 'Grams, or pieces - whatever the unit says.', '',
                    '', '', '', '', '', 'Worked out for you.',
                    'Speaks up if the same thing is counted twice.']);

  const firstRow = r;
  data.dishes.forEach(function (d) {
    const ref = refs.find(function (x) { return x.kind === 'dish' && x.name === d.name; });
    const out = "'Sauce Batches'!$D$" + ref.outAt;
    const per = "'Sauce Batches'!$E$" + ref.costAt;
    const unitCell = "'Sauce Batches'!$B$" + ref.outAt;

    const main = mainItemOf(d);

    known(ws, r, 1, d.name, { bold: true });
    known(ws, r, 2, numOf(d.price), { numFmt: MONEY, color: GREY });
    ask(ws, r, 3, { numFmt: QTY });
    calc(ws, r, 4, 'IF(' + unitCell + '="","",' + unitCell + ')', '', { numFmt: '@' });
    ask(ws, r, 5, { numFmt: '#,##0' });

    /*
      One number, two ways to reach it.

      A cook who ladles sauce can say how much goes on a plate. A cook who does
      not can say how many plates a pot does, which is the same fact divided the
      other way round. Taking whichever was answered means neither is a blocker,
      and showing the result means the shop can see the sheet understood them.
    */
    calc(ws, r, 6,
      'IF(ISNUMBER($C' + r + '),$C' + r + ','
      + 'IF(AND(ISNUMBER($E' + r + '),$E' + r + '>0,ISNUMBER(' + out + ')),' + out + '/$E' + r + ',""))',
      '', { numFmt: QTY, color: GREY });

    ask(ws, r, 7, { list: LIST_RANGE, value: main ? main.name : undefined });
    ask(ws, r, 8, { numFmt: QTY, value: main ? main.qty : undefined });
    // "NOT ON THE LIST" rather than a quiet "?": data validation is the first
    // thing a phone editor or WPS drops, so the sheet must still notice a
    // hand-typed name that matches nothing in the shop.
    calc(ws, r, 9,
      'IF($G' + r + '="","",IFERROR(VLOOKUP($G' + r + ',Lists!$A:$C,3,FALSE),"NOT ON THE LIST"))',
      main ? (lookupUnit(data, main.name) || '') : '', { numFmt: '@' });

    calc(ws, r, 10,
      'IF(OR(NOT(ISNUMBER($F' + r + ')),NOT(ISNUMBER(' + per + '))),"",$F' + r + '*' + per + ')', '');
    calc(ws, r, 11,
      'IF(OR($G' + r + '="",NOT(ISNUMBER($H' + r + '))),"",'
      + 'IFERROR($H' + r + '*VLOOKUP($G' + r + ',Lists!$A:$B,2,FALSE),""))',
      main ? Math.round(main.line * 10000) / 10000 : '');
    calc(ws, r, 12, 'IF(AND($J' + r + '="",$K' + r + '=""),"",N($J' + r + ')+N($K' + r + '))',
      main ? Math.round(main.line * 100) / 100 : '', { bold: true, fill: SUM_BG });
    calc(ws, r, 13, 'IF($L' + r + '="","",$B' + r + '-$L' + r + ')',
      main ? Math.round((numOf(d.price) - main.line) * 100) / 100 : '');
    calc(ws, r, 14,
      'IF(OR($L' + r + '="",$B' + r + '=0),"",($B' + r + '-$L' + r + ')/$B' + r + ')',
      main && numOf(d.price) ? (numOf(d.price) - main.line) / numOf(d.price) : '', { numFmt: PCT });
    calc(ws, r, 15,
      'IF(OR(NOT(ISNUMBER($F' + r + ')),$F' + r + '<=0,NOT(ISNUMBER(' + out + '))),"",'
      + out + '/$F' + r + ')', '', { numFmt: '#,##0' });

    /*
      The one arithmetic error left, and it needs a person to make it.

      Whatever the recipe already counted in pieces is kept out of the pot block
      entirely, so the ordinary case cannot double-count. What the generator
      cannot foresee is a cook nominating something here that they ALSO gave a
      pot amount for -- butter, say, which is genuinely in both the sauce and
      the pan. The plate would then pay for it twice and every margin on the
      page would be wrong in the flattering direction, which is the worst way to
      be wrong.

      SUMPRODUCT rather than COUNTIFS: it is pre-2007, and what matters is the
      PAIRING of "this name" with "somebody typed a pot amount on that row",
      not either one on its own.
    */
    calc(ws, r, 16,
      'IF($G' + r + '="","",'
      + 'IF(SUMPRODUCT((' + "'Sauce Batches'!$A$" + ref.firstLine + ':$A$' + ref.lastLine + '=$G' + r + ')'
      + '*(ISNUMBER(' + "'Sauce Batches'!$D$" + ref.firstLine + ':$D$' + ref.lastLine + ')))>0,'
      + '"This is also in the pot above - it would be paid for twice",""))',
      '', { numFmt: '@', color: 'FFB4341F' });
    r++;
  });
  const lastRow = r - 1;

  [26, 12, 15, 7, 16, 16, 24, 16, 15, 13, 15, 15, 12, 10, 14, 46].forEach(function (w, i) {
    ws.getColumn(i + 1).width = w;
  });
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: headAt + 1 }];
  return { firstRow: firstRow, lastRow: lastRow };
}

// ---------------------------------------------------------------------------
// Answers -- what the owner actually wanted to know
// ---------------------------------------------------------------------------

function buildAnswers(ws, data, plate, priceRange) {
  const SPAN = 6;
  let r = 1;
  titleRow(ws, r++, 'The answers - ' + data.tenant.name, SPAN);
  noteRow(ws, r++, 'This page fills itself in. Nothing here is typed.', SPAN, { height: 18 });
  r++;

  const P = "'On the Plate'!";
  const stillBlank = 'COUNTBLANK(Ingredients!$C$' + priceRange.first + ':$C$' + priceRange.last + ')';

  known(ws, r, 1, 'Prices still missing', { bold: true });
  calc(ws, r, 2, stillBlank, data.unpriced.length, { numFmt: '#,##0', bold: true });
  known(ws, r, 3, 'out of ' + data.unpriced.length + ' ingredients. Every dish using one is costed as free.',
    { italic: true, color: GREY });
  r++;

  known(ws, r, 1, 'Thinnest margin', { bold: true });
  calc(ws, r, 2,
    'IF(COUNT(' + P + '$N$' + plate.firstRow + ':$N$' + plate.lastRow + ')=0,"-",'
    + 'INDEX(' + P + '$A$' + plate.firstRow + ':$A$' + plate.lastRow + ','
    + 'MATCH(MIN(' + P + '$N$' + plate.firstRow + ':$N$' + plate.lastRow + '),'
    + P + '$N$' + plate.firstRow + ':$N$' + plate.lastRow + ',0)))', '-', { numFmt: '@', bold: true });
  known(ws, r, 3, 'The dish to look at first.', { italic: true, color: GREY });
  r++;

  known(ws, r, 1, 'Fattest margin', { bold: true });
  calc(ws, r, 2,
    'IF(COUNT(' + P + '$N$' + plate.firstRow + ':$N$' + plate.lastRow + ')=0,"-",'
    + 'INDEX(' + P + '$A$' + plate.firstRow + ':$A$' + plate.lastRow + ','
    + 'MATCH(MAX(' + P + '$N$' + plate.firstRow + ':$N$' + plate.lastRow + '),'
    + P + '$N$' + plate.firstRow + ':$N$' + plate.lastRow + ',0)))', '-', { numFmt: '@', bold: true });
  r += 2;

  headerRow(ws, r++, ['Dish', 'Sells for ₱', 'Costs to make', 'You keep', 'Margin', 'Plates per pot']);
  for (let i = plate.firstRow; i <= plate.lastRow; i++) {
    calc(ws, r, 1, P + '$A$' + i, '', { numFmt: '@', bold: true });
    calc(ws, r, 2, P + '$B$' + i, '', { numFmt: MONEY });
    // L cost per plate, M what is kept, N margin, O plates per pot
    calc(ws, r, 3, 'IF(' + P + '$L$' + i + '="","",' + P + '$L$' + i + ')', '', { numFmt: MONEY });
    calc(ws, r, 4, 'IF(' + P + '$M$' + i + '="","",' + P + '$M$' + i + ')', '', { numFmt: MONEY });
    calc(ws, r, 5, 'IF(' + P + '$N$' + i + '="","",' + P + '$N$' + i + ')', '', { numFmt: PCT });
    calc(ws, r, 6, 'IF(' + P + '$O$' + i + '="","",' + P + '$O$' + i + ')', '', { numFmt: '#,##0' });
    r++;
  }

  [26, 14, 15, 13, 10, 15].forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
}

// ---------------------------------------------------------------------------
// Start Here -- what to do, in the order it has to happen
// ---------------------------------------------------------------------------

function buildStart(ws, data) {
  const SPAN = 2;
  let r = 1;
  titleRow(ws, r++, data.tenant.name + ' - recipe costing', SPAN);
  r++;

  const para = function (text, opts) { noteRow(ws, r++, text, SPAN, opts || {}); };
  const head = function (text) {
    r++;
    noteRow(ws, r++, text, SPAN, { bold: true, size: 11, color: BRAND });
  };

  para('Right now Clerque cannot tell you what a plate of wings costs, and it is not because anything '
    + 'is broken. Two things are genuinely not written down anywhere.', { height: 30 });
  para('');
  para('First, ' + data.unpriced.length + ' ingredients have no price at all - the soy sauce, the honey, '
    + 'the butter, the salt. A dish made of those is costed as if it were free.', { height: 28 });
  para('Second, nobody has ever measured how much sauce comes out of a pot. Without that, there is no way '
    + 'to know what a spoonful costs, however carefully everything else is counted.', { height: 28 });

  head('There are four questions, and a cook can answer all of them');
  para('1.  What does one pack of each ingredient cost?          ->  the "Ingredients" tab');
  para('2.  What goes into ONE POT of each sauce?                ->  the "Sauce Batches" tab');
  para('3.  How much comes OUT of that pot?                      ->  the "Sauce Batches" tab');
  para('4.  How much sauce goes on ONE PLATE?                    ->  the "On the Plate" tab');
  para('');
  para('Nobody is asked how many servings a pot makes. That is question 3 divided by question 4, and the '
    + '"Answers" tab works it out.', { height: 26 });

  head('How to fill it in');
  para('Only the shaded cells need anything. Everything else is either what Clerque already holds, or a '
    + 'number that works itself out as you type.', { height: 26 });
  para('Ingredient names come from a dropdown. Please use it rather than typing - a name that differs by '
    + 'one letter becomes a second ingredient with its own stock and its own cost. This shop already has '
    + '"Chicken Wings" and "Chicken wings" as two separate things.', { height: 34 });
  para('You only have to measure a pot ONCE. If later pots come out different, say so and we will change '
    + 'the number.', { height: 22 });
  para('Half-filled is fine. Send it back with what you know - every sauce that is finished starts costing '
    + 'correctly on its own.', { height: 22 });

  head('For whoever loads this back into Clerque');
  para('The "Ingredients" tab is deliberately the importer\'s own sheet: its name, its headers and its hint '
    + 'row are byte-for-byte what Settings -> Import Templates -> Import expects on the INGREDIENTS row. '
    + 'Upload it there and nowhere else - parseFile falls back to the first sheet in the file when the name '
    + 'does not match, so uploading it on another row would parse this page as data.', { height: 40 });
  para('Recipe Unit is prefilled and locked on every row. Left blank, an upload would overwrite the stored '
    + 'unit and leave the stock count behind it unscaled - butter held in grams would become butter held in '
    + 'kilos, with the same number on the shelf.', { height: 34 });
  para('The pot amounts and the yields have no import path at all: there is no sheet, header or parser for '
    + 'sub-recipes anywhere in the import module. They are typed into Procure -> Prep & Batches -> Set up.',
    { height: 30 });
  para('Prices alone will not recost a sauce. A sub-recipe\'s cost is only ever written inside makeBatch\'s '
    + 'weighted-average blend, so after the prices land, each prep needs one batch recorded - with the '
    + 'measured yield in "Measured what came out?" - before the sauce carries a cost. That field is the '
    + 'total for the whole submission, not per batch.', { height: 42 });
  para('Recording a batch also needs the components in stock at that branch, or makeBatch refuses on the '
    + 'first one that is short.', { height: 24 });
  para('A sub-recipe does no unit conversion of its own: every component line is multiplied by that '
    + 'ingredient\'s cost raw, so pot amounts must be in the ingredient\'s own unit. The Unit column on the '
    + 'Sauce Batches tab shows what that is for every line.', { height: 34 });

  head('What this does NOT account for');
  para('Waste. The sheet works out cost per plate as the pot divided by the plates it makes, which quietly '
    + 'assumes every pot is sold to the last gram - no scrapings, no spoilage, no batch thrown out at close. '
    + 'Real cost per plate is a few per cent higher than what you see here.', { height: 34 });
  para('Anything on the plate that is not the sauce and not the main item - the oil it was fried in, the '
    + 'packaging, the labour. Those sit outside this file.', { height: 26 });
  para('And these prices do not stay put. The first stock delivery you record in Clerque recomputes the '
    + 'ingredient cost as a weighted average of what you actually paid, which is the right behaviour and '
    + 'will move these numbers. What this sheet fixes is the starting point, not the price forever.',
    { height: 38 });

  head('Still to decide');
  para('Chicken wings are counted in pieces (pc) today. If they are to be counted in grams instead - which '
    + 'is the more honest unit for something bought by the kilo - that is a change to the ingredient and to '
    + 'the recipe lines, not something this sheet can do.', { height: 34 });
  const dupes = [];
  data.collisions.forEach(function (twins, id) {
    const m = data.materials.find(function (x) { return x.id === id; });
    if (m) dupes.push('"' + m.name + '"');
  });
  if (dupes.length) {
    para('These names differ only by capitalisation and are separate ingredients in Clerque today: '
      + dupes.join(', ') + '. Worth merging before any of this is loaded.', { height: 30 });
  }

  r++;
  noteRow(ws, r++, 'Generated from ' + data.tenant.slug + ' - '
    + data.materials.length + ' ingredients, ' + data.dishes.length + ' dishes, '
    + data.preps.length + ' existing preps.', SPAN, { size: 9, color: GREY });

  ws.getColumn(1).width = 110;
  ws.getColumn(2).width = 4;
}

// ---------------------------------------------------------------------------

async function main() {
  // Loaded here rather than at module scope: recipe-costing-sheet.spec.ts
  // requires this file for its header constants, and a spec has no business
  // reading the developer's .env to do it.
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  const prisma = new PrismaClient();
  try {
    const data = await load(prisma);
    if (!data.unpriced.length) {
      console.log('Every ingredient in "' + data.tenant.slug + '" already has a price. Nothing to ask for.');
      return;
    }

    LIST_RANGE = 'Lists!$A$2:$A$' + (data.materials.length + 1);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';
    wb.created = new Date();
    /*
      Excel recalculates the whole book on open. Every formula also ships with
      the value it evaluates to today, so a reader that does NOT calculate --
      Google Drive preview, a phone, Protected View -- still shows numbers
      rather than a grid of blanks.
    */
    wb.calcProperties.fullCalcOnLoad = true;

    const start   = wb.addWorksheet('Start Here');
    const prices  = wb.addWorksheet('Ingredients');
    const batches = wb.addWorksheet('Sauce Batches');
    const plate   = wb.addWorksheet('On the Plate');
    const answers = wb.addWorksheet('Answers');
    const lists   = wb.addWorksheet('Lists');

    const priceRows = buildPrices(prices, data);
    const rowNums = [...priceRows.values()];
    const priceRange = { first: Math.min.apply(null, rowNums), last: Math.max.apply(null, rowNums) };

    buildLists(lists, data, priceRows);
    const refs = buildBatches(batches, data);
    const plateRange = buildPlate(plate, data, refs);
    buildAnswers(answers, data, plateRange, priceRange);
    buildStart(start, data);

    // Lock the formulas, leave every input cell open. Not applied to Lists,
    // which is hidden, or Start Here, which has nothing to protect.
    await lockDown(prices);
    await lockDown(batches);
    await lockDown(plate);
    await lockDown(answers);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const safe = data.tenant.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const outFile = path.join(OUT_DIR, safe + '-Recipe-Costing.xlsx');
    await wb.xlsx.writeFile(outFile);

    const size = fs.statSync(outFile).size;
    console.log('Wrote ' + outFile + ' (' + size + ' bytes)');
    console.log('  ' + data.unpriced.length + ' ingredients with no price');
    console.log('  ' + data.dishes.length + ' dishes affected, ' + data.preps.length + ' existing preps');
    console.log('  ' + data.collisions.size + ' names that differ only by capitalisation');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(function (err) {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  IMPORTER_HEADERS: IMPORTER_HEADERS,
  IMPORTER_HINTS: IMPORTER_HINTS,
  EXTRA_HEADER: EXTRA_HEADER,
  EXTRA_HINT: EXTRA_HINT,
  UNIT_TABLE: UNIT_TABLE,
  BUY_UNITS: BUY_UNITS,
};
