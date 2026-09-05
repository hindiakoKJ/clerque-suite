/**
 * Cafe Carolina — kitchen setup workbook, pre-filled from the owner's own
 * "GARLIC CHICKEN.xlsx" and Anne's answers (86 pieces per 10 kg sack, signed
 * off; sauce cooked per order; two wings a plate).
 *
 * The whole point: NOTHING here calculates. The kitchen writes what it knows
 * -- what it buys, what goes into a batch, what goes on a plate -- and
 * Clerque works out every cost when the file is uploaded as a Setup Pack.
 * The owner's sheet failed on formulas: totals hand-copied between tabs,
 * blank rows costing PHP 1 a gram, and "pcs", "g" and "portion" mixed.
 *
 * Every sheet here is the importer's own contract, so the file round-trips:
 *   Products        -> importProductsFromRows
 *   Ingredients     -> importIngredientsFromRows   (buy unit -> recipe unit)
 *   Made in batches -> importPrepsFromRows          (preps with yields)
 *   Recipes         -> importRecipesFromRows        (per ONE plate)
 *
 * Cells the kitchen still has to confirm are tinted and listed on the last
 * sheet, with the question written next to the number we used.
 *
 *   node scripts/gen-kitchen-setup-sheet.js          -> ../../onboarding/Carolina-Kitchen-Setup.xlsx
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const OUT = path.resolve(__dirname, '../../../onboarding/Carolina-Kitchen-Setup.xlsx');

const BRAND  = 'FF8B5E3C';
const CREAM  = 'FFF5F1EC';
const WHITE  = 'FFFFFFFF';
const INK    = 'FF333333';
const GREY   = 'FF777777';
const ASK_BG = 'FFFFF6E0';   // a number the kitchen has to confirm
const HINT_BG = 'FFF3F3F3';

// ── the data, in the importer's words ────────────────────────────────────────

const PRODUCTS = {
  headers: ['Name*', 'Category', 'Price*', 'Cost Price*', 'VAT (Y/N)', 'Barcode', 'Description', 'Opening Stock', 'Low Stock Alert'],
  hint:    ['Required.', 'Optional.', 'Required. Selling price.', 'Required. 0 here -- the recipe decides it.', 'Y or N', 'Optional.', 'Optional.', 'Leave blank: made to order.', 'Optional.'],
  rows: [
    ['Garlic Chicken w/ Rice',  'Kitchen', '255', '0', 'N', '', '2 pcs marinated wings, garlic sauce, rice',  '', ''],
    ['Garlic Chicken w/ Fries', 'Kitchen', '255', '0', 'N', '', '2 pcs marinated wings, garlic sauce, fries', '', ''],
  ],
  ask: { 'Garlic Chicken w/ Rice': [2], 'Garlic Chicken w/ Fries': [2] },   // the price is a guess: 2.5 x their cost
};

// Unit* = what you BUY it as. Recipe Unit = what the kitchen measures in.
// Pack Size = how many Recipe Units in ONE of what you buy, ONLY for containers.
// kg->g and L->ml convert by themselves, so Pack Size stays blank there.
const INGREDIENTS = {
  headers: ['Name*', 'Unit*', 'Cost per Unit (₱)*', 'Low Stock Alert', 'Notes', 'Recipe Unit', 'Pack Size', 'Category'],
  hint:    ['Required. Unique.', 'Required. How you BUY it.', 'Required. Price of ONE of that.', 'Optional.', 'Optional.', 'How the kitchen counts it.', 'Only for a container: how many Recipe Units in one.', 'Blank = Ingredient.'],
  rows: [
    ['Chicken Wings',     'sack', '2500',   '', '10 kg sack. 86 pcs per sack -- the agreed standard.', 'pc', '86',    ''],
    ['All Purpose Flour', 'pack', '45.75',  '', '500 g pack',                                          'g',  '500',   ''],
    ['Cornstarch',        'kg',   '68',     '', '',                                                    'g',  '',      ''],
    ['Spanish Paprika',   'pack', '77.15',  '', '35 g pack',                                           'g',  '35',    ''],
    ['Chicken Powder',    'kg',   '482.55', '', '',                                                    'g',  '',      ''],
    ['Pepper',            'kg',   '500',    '', '',                                                    'g',  '',      ''],
    ['Salt',              'pack', '75',     '', '550 g pack (the fries sheet had it right)',           'g',  '550',   ''],
    ['Butter',            'pack', '46.85',  '', '200 g pack',                                          'g',  '200',   ''],
    ['Fresh Garlic',      'kg',   '120',    '', '',                                                    'g',  '',      ''],
    ['Liquid Seasoning',  'L',    '340',    '', '',                                                    'ml', '',      ''],
    ['Sugar',             'kg',   '96',     '', '',                                                    'g',  '',      ''],
    ['Uncooked Rice',     'sack', '1400',   '', '25 kg sack',                                          'g',  '25000', ''],
    ['Dried Parsley',     'pack', '99',     '', '50 g pack',                                           'g',  '50',    ''],
    ['Frozen Fries',      'kg',   '175',    '', '',                                                    'g',  '',      ''],
    ['Ziplock',           'pack', '46.20',  '', 'Pack of 10. Packaging is an expense, not part of the plate cost.', 'pc', '10', 'Kitchen Supply'],
  ],
  ask: { 'Chicken Wings': [6] },   // 86 -- confirm on the next two or three deliveries
};

const PREPS = {
  headers: ['Prep Name*', 'One batch makes*', 'Counted in*', 'Ingredient*', 'Quantity per batch*', 'Unit', 'Notes'],
  hint:    ['Required on every row.', 'First row of each prep.', 'First row. pc / serving / portion / g.', 'A bought item, or another prep.', 'Into ONE batch.', 'Blank = ingredient\'s own unit.', 'Optional.'],
  rows: [
    ['Breading',                '100', 'portion', 'All Purpose Flour', '1000', 'g',  'One batch coats about 100 pieces'],
    ['Breading',                '',    '',        'Cornstarch',        '1000', 'g',  ''],
    ['Breading',                '',    '',        'Salt',              '15',   'g',  ''],
    ['Breading',                '',    '',        'Spanish Paprika',   '15',   'g',  ''],
    ['Breading',                '',    '',        'Chicken Powder',    '15',   'g',  ''],
    ['Breading',                '',    '',        'Pepper',            '7.5',  'g',  ''],
    ['Marinated Chicken Wings', '86',  'pc',      'Chicken Wings',     '86',   'pc', 'One 10 kg sack = 86 pieces, marinated and held ready'],
    ['Marinated Chicken Wings', '',    '',        'Breading',          '86',   'portion', 'One portion of breading per piece'],
    ['Cooked Rice',             '375', 'serving', 'Uncooked Rice',     '25',   'kg', 'A 25 kg sack makes 375 servings'],
    ['Cooked Rice',             '',    '',        'Dried Parsley',     '1',    'g',  ''],
    ['French Fries',            '1',   'serving', 'Frozen Fries',      '75',   'g',  'Per serving -- the old sheet divided 75 g across 13'],
    ['French Fries',            '',    '',        'Salt',              '2',    'g',  ''],
    ['French Fries',            '',    '',        'Dried Parsley',     '1',    'g',  ''],
  ],
  // [row index, column index] cells to tint: yields and amounts still to confirm
  askCells: [[0, 1], [6, 6], [8, 1], [9, 4], [10, 1]],
};

// Per ONE plate. The garlic sauce is cooked to order, so its ingredients go
// straight here -- it is not a batch. A KITCHEN SUPPLY (the ziplock) cannot go
// on a recipe: Clerque treats packaging as an expense, not a cost of sale.
const RECIPES = {
  headers: ['Product Name*', 'Ingredient Name*', 'Quantity*', 'Unit'],
  hint:    ['Required. Exactly as on Products.', 'A bought item or a prep.', 'Per ONE plate.', 'Blank = ingredient\'s own unit.'],
  rows: [
    ['Garlic Chicken w/ Rice',  'Marinated Chicken Wings', '2',   'pc'],
    ['Garlic Chicken w/ Rice',  'Cooked Rice',             '1',   'serving'],
    ['Garlic Chicken w/ Rice',  'Butter',                  '4.8', 'g'],
    ['Garlic Chicken w/ Rice',  'Fresh Garlic',            '5',   'g'],
    ['Garlic Chicken w/ Rice',  'Liquid Seasoning',        '80',  'ml'],
    ['Garlic Chicken w/ Rice',  'Sugar',                   '76',  'g'],
    ['Garlic Chicken w/ Fries', 'Marinated Chicken Wings', '2',   'pc'],
    ['Garlic Chicken w/ Fries', 'French Fries',            '1',   'serving'],
    ['Garlic Chicken w/ Fries', 'Butter',                  '4.8', 'g'],
    ['Garlic Chicken w/ Fries', 'Fresh Garlic',            '5',   'g'],
    ['Garlic Chicken w/ Fries', 'Liquid Seasoning',        '80',  'ml'],
    ['Garlic Chicken w/ Fries', 'Sugar',                   '76',  'g'],
  ],
  askCells: [[4, 2], [5, 2], [10, 2], [11, 2]],   // the sauce amounts
};

const QUESTIONS = [
  ['Sheet', 'Where', 'What we used', 'The question for the kitchen'],
  ['Ingredients',     'Chicken Wings, Pack Size',            '86 pcs per 10 kg sack', 'Signed off as the standard. Still worth counting the next 2-3 deliveries: every plate cost multiplies by this number.'],
  ['Made in batches', 'Breading, One batch makes',           '100 portions',          'A chicken batch is 86 pieces. Is one batch of breading used on one batch of chicken? Is the leftover thrown out? (If yes, the real cost is 218.55 / 86, not / 100.)'],
  ['Made in batches', 'Marinated Chicken Wings, ingredients', 'chicken + breading only', 'Is there really nothing in the marinade -- asin, toyo, calamansi? The old sheet listed only chicken and breading.'],
  ['Made in batches', 'Cooked Rice, Dried Parsley',          '1 g for the whole 25 kg', '1 gram of parsley in 375 servings -- per batch, or per serving?'],
  ['Made in batches', 'Cooked Rice, One batch makes',        '375 servings',          'Confirm servings from one 25 kg sack, and how many grams one cooked serving is.'],
  ['Made in batches', 'French Fries, One batch makes',       '1 serving of 75 g',     'The old sheet divided 75 g across 13 servings (5.8 g each). We took 75 g as ONE serving. Right?'],
  ['Recipes',         'Liquid Seasoning per plate',          '80 ml',                 'That is about 5 tablespoons on two wings, and PHP 27 of seasoning a plate. How many KUTSARA go into one order\'s sauce?'],
  ['Recipes',         'Sugar per plate',                     '76 g',                  'About 6 tablespoons. How many kutsara, really?'],
  ['Recipes',         'Butter and garlic per plate',         '4.8 g and 5 g',         'Less than a teaspoon of each against 6 spoons of sugar -- do these look right side by side?'],
  ['Products',        'Selling price',                       'PHP 255',               'A guess from 2.5 x the old cost. What is the actual menu price of each plate today?'],
  ['Recipes',         'Packaging',                           'not on the plate',      'Clerque books packaging as an expense, not as part of the plate cost. Is a ziplock the only packaging per order? Box, bag, sauce cup, cutlery?'],
];

// ── workbook ─────────────────────────────────────────────────────────────────

function styleHeader(ws, r, n) {
  for (let c = 1; c <= n; c++) {
    const cell = ws.getCell(r, c);
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.alignment = { vertical: 'middle' };
  }
  ws.getRow(r).height = 20;
}
function styleHint(ws, r, n) {
  for (let c = 1; c <= n; c++) {
    const cell = ws.getCell(r, c);
    cell.font = { italic: true, size: 9, color: { argb: GREY } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HINT_BG } };
    cell.alignment = { wrapText: true, vertical: 'top' };
  }
  ws.getRow(r).height = 30;
}
function ask(cell) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ASK_BG } };
  cell.note = 'Please confirm this number -- see the "Questions for the kitchen" sheet.';
}

function dataSheet(wb, name, spec, widths) {
  const ws = wb.addWorksheet(name);
  ws.addRow(spec.headers); styleHeader(ws, 1, spec.headers.length);
  ws.addRow(spec.hint);    styleHint(ws, 2, spec.headers.length);
  spec.rows.forEach((row) => ws.addRow(row));
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  (spec.askCells || []).forEach(([ri, ci]) => ask(ws.getCell(ri + 3, ci + 1)));
  if (spec.ask) {
    Object.entries(spec.ask).forEach(([rowName, cols]) => {
      const idx = spec.rows.findIndex((r) => r[0] === rowName);
      if (idx >= 0) cols.forEach((ci) => ask(ws.getCell(idx + 3, ci + 1)));
    });
  }
  return ws;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Clerque';

  const readme = wb.addWorksheet('Read Me');
  readme.getColumn(1).width = 110;
  const lines = [
    ['Cafe Carolina -- kitchen setup', { bold: true, size: 16, color: { argb: BRAND } }],
    [''],
    ['Nothing on these sheets calculates. Write what you know; Clerque works out every cost when this file is uploaded.'],
    [''],
    ['How the sheets fit together', { bold: true }],
    ['  Products         what you SELL. Two plates to start with. Cost stays 0 -- the recipe decides it.'],
    ['  Ingredients      what you BUY. Two units: how you buy it (sack, kg, pack) and how the kitchen counts it (pc, g, ml).'],
    ['                   For a container, Pack Size says how many kitchen units are in ONE of what you buy: 86 pc in a sack.'],
    ['  Made in batches  what you make AHEAD and hold: breading, marinated wings, cooked rice, fries.'],
    ['                   One row per ingredient. On the first row of each prep, how much ONE batch makes.'],
    ['  Recipes          what goes on ONE plate. A prep counts as an ingredient: "2 pc Marinated Chicken Wings".'],
    ['                   The garlic sauce is cooked per order, so its ingredients go straight on the plate here.'],
    [''],
    ['Three rules', { bold: true }],
    ['  1. Prices are the price of ONE of what you buy -- one sack, one kg, one pack. Never divide it yourself.'],
    ['  2. Quantities in a batch are for ONE batch. Quantities on a plate are for ONE plate.'],
    ['  3. Names must match across sheets exactly. Copy them; do not retype them.'],
    [''],
    ['Tinted cells are numbers we took from the old sheet but could not confirm. Each one is listed, with its'],
    ['question, on the last sheet. Fix the number in place -- do not add rows for it.'],
    [''],
    ['When it is filled in: Settings -> Import Templates -> Setup Pack -> upload this file. The sheets go in the right'],
    ['order by themselves. Then record one delivery of chicken under Procure, and the plates cost themselves.'],
  ];
  lines.forEach(([text, font]) => {
    const row = readme.addRow([text]);
    row.getCell(1).font = { color: { argb: INK }, ...(font || {}) };
  });
  readme.getRow(1).height = 26;

  dataSheet(wb, 'Products',        PRODUCTS,    [26, 12, 10, 12, 10, 12, 42, 14, 14]);
  dataSheet(wb, 'Ingredients',     INGREDIENTS, [22, 10, 18, 14, 48, 12, 12, 16]);
  dataSheet(wb, 'Made in batches', PREPS,       [26, 16, 12, 22, 18, 10, 48]);
  dataSheet(wb, 'Recipes',         RECIPES,     [26, 26, 12, 10]);

  const q = wb.addWorksheet('Questions for the kitchen');
  QUESTIONS.forEach((r) => q.addRow(r));
  styleHeader(q, 1, 4);
  [16, 34, 26, 90].forEach((w, i) => { q.getColumn(i + 1).width = w; });
  for (let r = 2; r <= QUESTIONS.length; r++) {
    q.getRow(r).alignment = { wrapText: true, vertical: 'top' };
    q.getCell(r, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ASK_BG } };
  }
  q.views = [{ state: 'frozen', ySplit: 1 }];

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await wb.xlsx.writeFile(OUT);
  console.log('wrote', OUT);
}

module.exports = { PRODUCTS, INGREDIENTS, PREPS, RECIPES, QUESTIONS };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
