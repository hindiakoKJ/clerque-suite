import { recipeFirst } from './procure-receipts.service';
import { matchIngredient, MaterialRef } from './receipt-parser';

/**
 * The receipt reader and the twin ingredient records.
 *
 * Carolina's shop has "Ice" (g), used in 48 drinks, sitting beside "Ice Cubes"
 * (kg) and "Ice Cubes + Delivery" (kg), which no recipe uses at all. A COD
 * receipt prints ICE CUBES 5KG, so the reader scored "Ice Cubes" a perfect
 * match and pre-selected it. The delivery went onto a record nothing reads:
 * Ice never moved, and the till kept refusing every iced drink.
 *
 * The reader cannot know which record the shop meant. What it can do is stop
 * answering for the person when the name it picked is in no recipe and one
 * that IS sits inside it -- and always offer the recipe records first.
 */
const ref = (id: string, name: string, unit = 'g'): MaterialRef =>
  ({ id, name, unit, category: 'INGREDIENT', costPrice: 1 });

const ICE       = ref('ice', 'Ice');
const ICE_CUBES = ref('ice-cubes', 'Ice Cubes', 'kg');
const ICE_DEL   = ref('ice-del', 'Ice Cubes + Delivery', 'kg');
const ZONROX    = ref('zonrox', 'Zonrox Bleach', 'ml');
const BEANS     = ref('beans', 'Coffee Beans');

const run = (line: string, materials: MaterialRef[], inRecipe: string[]) =>
  recipeFirst(line, matchIngredient(line, materials), materials, new Set(inRecipe));

const named = (r: ReturnType<typeof run>) => ({
  best: r.best?.material.name ?? null,
  alternatives: r.alternatives.map((a) => a.material.name),
});

describe('what the receipt reader offers when twins exist', () => {
  const SHELF = [ICE, ICE_CUBES, ICE_DEL, ZONROX, BEANS];

  it('stops pre-selecting the twin, and offers the record the drinks use first', () => {
    // Before: "Ice Cubes" scored 1.0 and was pre-selected; "Ice" scored 0.5
    // and sat below "Ice Cubes + Delivery".
    const plain = matchIngredient('ICE CUBES 5KG', SHELF);
    expect(plain.best?.material.name).toBe('Ice Cubes');

    expect(named(run('ICE CUBES 5KG', SHELF, ['ice']))).toEqual({
      best: null,                       // nobody answers for the person
      alternatives: ['Ice', 'Ice Cubes', 'Ice Cubes + Delivery'],
    });
  });

  it('never drops the twin from the choices -- a shop that really buys bagged ice needs it', () => {
    const r = run('ICE CUBES 5KG', SHELF, ['ice']);
    expect(r.alternatives.map((a) => a.material.id)).toContain('ice-cubes');
  });

  it('leaves a match the recipes do use exactly as it was', () => {
    const r = run('ARABICA COFFEE BEANS 1KG', SHELF, ['beans']);
    expect(r.best?.material.name).toBe('Coffee Beans');
  });

  it('leaves a supply alone: bleach is in no recipe, and no recipe item looks like it', () => {
    const r = run('ZONROX BLEACH 1L', SHELF, ['ice', 'beans']);
    expect(r.best?.material.name).toBe('Zonrox Bleach');
  });

  it('ranks recipe records above the rest in the alternatives, whatever the best is', () => {
    // "Yogurt" is what the recipes use; "Emborg Yogurt" and "Yogurt Drink" are not.
    const yog  = ref('yog', 'Yogurt', 'ml');
    const shelf = [ref('emborg', 'Emborg Yogurt', 'L'), ref('drink', 'Yogurt Drink', 'ml'), yog];
    const r = run('EMBORG YOGURT 1L', shelf, ['yog']);
    expect(r.alternatives[0].material.id).toBe('yog');
  });

  it('changes nothing for a shop whose ingredients are all in recipes', () => {
    const shelf = [ICE, BEANS];
    const plain = matchIngredient('COFFEE BEANS 1KG', shelf);
    const after = run('COFFEE BEANS 1KG', shelf, ['ice', 'beans']);
    expect(after.best?.material.id).toBe(plain.best?.material.id);
  });

  it('does not stop answering when nothing in a recipe looks like the pick', () => {
    // "Ice" is in a recipe but is nothing like "GASUL 11KG", so the reader
    // keeps its answer. Blocking here would put a question on every line.
    const gasul = ref('gasul', 'Gasul', 'pc');
    const r = run('GASUL 11KG', [gasul, ICE], ['ice']);
    expect(r.best?.material.name).toBe('Gasul');
  });

  it('survives a reading that matched nothing at all', () => {
    expect(named(run('SERVICE CHARGE', [ICE], ['ice']))).toEqual({ best: null, alternatives: [] });
  });
});
