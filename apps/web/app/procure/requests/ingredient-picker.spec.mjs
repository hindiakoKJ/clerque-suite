/**
 * Run: cd apps/web && node --test app/procure/requests/ingredient-picker.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 *
 * The shop's ingredient list holds twins. "Ice Cubes" and "Ice Cubes +
 * Delivery" sit beside the "Ice" that 48 drinks are made with, and only "Ice"
 * is in any recipe. Ice bought against a twin never reaches the drinks: the
 * till keeps reading Ice as empty and refuses every iced drink, while the
 * stock that was actually delivered sits on a record nothing looks at.
 *
 * COD ice comes in every day, so this is a day-1 mistake, not a rare one. The
 * picker cannot know which one the barista means -- but it can put the record
 * the recipes read first, and say plainly when one is in no recipe at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickerOrder, showNotInRecipe } from './ingredient-picker.ts';

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

const ITEMS = [
  { id: 'ice-cubes',   name: 'Ice Cubes',            inRecipe: false, category: 'INGREDIENT' },
  { id: 'ice-cubes-d', name: 'Ice Cubes + Delivery', inRecipe: false, category: 'INGREDIENT' },
  { id: 'ice',         name: 'Ice',                  inRecipe: true,  category: 'INGREDIENT' },
  { id: 'zonrox',      name: 'Zonrox Bleach',        inRecipe: false, category: 'KITCHEN_SUPPLY' },
];
const names = (list) => list.map((i) => i.name);

test('the Ice the drinks are made with comes before the two Ice twins', () => {
  assert.deepEqual(
    names(pickerOrder(ITEMS, new Set(), 'ice')),
    ['Ice', 'Ice Cubes', 'Ice Cubes + Delivery'],
  );
});

test('the twins are still offered -- ranked down, never hidden', () => {
  // Some of them are real: a shop that buys bagged ice AND makes its own has
  // both, and hiding one would leave a delivery with nowhere to go.
  const all = pickerOrder(ITEMS, new Set(), '');
  assert.equal(all.length, ITEMS.length);
});

test('within each group it stays alphabetical, so the list does not jump around', () => {
  const both = [
    { id: 'b', name: 'Brown Sugar', inRecipe: true },
    { id: 'a', name: 'Arabica Beans', inRecipe: true },
    { id: 'd', name: 'Emborg Yogurt', inRecipe: false },
    { id: 'c', name: 'Coffee Beans', inRecipe: false },
  ];
  assert.deepEqual(
    names(pickerOrder(both, new Set(), '')),
    ['Arabica Beans', 'Brown Sugar', 'Coffee Beans', 'Emborg Yogurt'],
  );
});

test('what is already on the list is left out, as it always was', () => {
  assert.deepEqual(names(pickerOrder(ITEMS, new Set(['ice']), 'ice')), ['Ice Cubes', 'Ice Cubes + Delivery']);
});

test('an older API that sends no inRecipe ranks and labels nothing', () => {
  // The flag is new. Until every API a shop runs sends it, the picker behaves
  // exactly as it did: alphabetical, no labels, nothing pushed down.
  const old = [{ id: 'b', name: 'Beans' }, { id: 'a', name: 'Ampalaya' }];
  assert.deepEqual(names(pickerOrder(old, new Set(), '')), ['Ampalaya', 'Beans']);
  assert.equal(showNotInRecipe(old[0]), false);
});

test('"not in any recipe" is said about an ingredient, never about bleach', () => {
  assert.equal(showNotInRecipe(ITEMS[0]), true);   // Ice Cubes
  assert.equal(showNotInRecipe(ITEMS[2]), false);  // Ice itself
  assert.equal(showNotInRecipe(ITEMS[3]), false);  // Zonrox Bleach, a supply
  // An item with no category at all is treated as an ingredient, which is how
  // the rest of the app reads a blank category.
  assert.equal(showNotInRecipe({ id: 'x', name: 'Yogurt', inRecipe: false }), true);
});

test('the Buy list page uses this ordering and shows the label', () => {
  // A helper nobody calls fixes nothing.
  assert.match(page, /pickerOrder\(ingredients, alreadyIn, search\)/);
  assert.match(page, /showNotInRecipe\(i\)/);
  assert.match(page, /not in any recipe/);
});
