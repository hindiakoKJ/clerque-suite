/**
 * The order of the Buy list's ingredient picker, kept apart from the page so
 * Node's own test runner can check it (see ingredient-picker.spec.mjs).
 *
 * The shop's list holds twins that no recipe uses: "Ice Cubes" beside the
 * "Ice" that 48 drinks use. Ice bought against the twin never reaches the
 * recipes, so the till keeps reading Ice as empty and refuses iced drinks.
 * So the items a recipe uses come first, and an ingredient no recipe uses
 * says so.
 */

export interface PickerIngredient {
  id: string;
  name: string;
  /** From GET /inventory/raw-materials. Missing means not known: no ranking, no label. */
  inRecipe?: boolean;
  category?: string;
}

/** Not on the list yet, narrowed by the filter; recipe items first, then A to Z. */
export function pickerOrder<T extends PickerIngredient>(all: T[], alreadyIn: Set<string>, search: string): T[] {
  const q = search.toLowerCase();
  const rank = (i: T) => (i.inRecipe === false ? 1 : 0);
  return all
    .filter((i) => !alreadyIn.has(i.id) && i.name.toLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Whether to say "not in any recipe" under it. Only for an ingredient: a
 * supply (bleach, gloves, Gasul) is never in a recipe, and saying so on every
 * one of them would bury the label where it matters.
 */
export const showNotInRecipe = (i: PickerIngredient): boolean =>
  i.inRecipe === false && (i.category == null || i.category === 'INGREDIENT');
