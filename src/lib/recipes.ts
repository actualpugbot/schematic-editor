export type RecipeType =
  | 'crafting_shaped'
  | 'crafting_shapeless'
  | 'stonecutting'
  | 'smelting'
  | 'blasting'
  | 'smoking'
  | 'campfire_cooking';

export interface Recipe {
  type: RecipeType;
  output: number;
  inputs: Record<string, number>;
}

export interface MaterialLike {
  id: string;
  label?: string;
  count: number;
  color?: number;
  stateKey?: string;
}

export interface BreakdownOptions {
  /** Items the user forces to be treated as a base material even if they have a recipe. */
  rawOverrides: Set<string>;
  /** Items the user forces to break down even if they are a base material by default. */
  craftOverrides?: Set<string>;
  recipeChoice: Map<string, number>;
  recipeTypePreference: RecipeType[];
  integerCrafting: boolean;
  owned?: Map<string, number>;
}

export interface BreakdownNode {
  id: string;
  count: number;
  isRaw: boolean;
  recipeUsed?: Recipe;
  children: BreakdownNode[];
  surplus?: number;
}

export interface BreakdownResult {
  raw: MaterialLike[];
  trees: BreakdownNode[];
  unresolved: string[];
}

export interface RecipeBundle {
  recipes: Record<string, Recipe[]>;
  raw: string[];
}

let recipeBundle: RecipeBundle | null = null;
let recipeBundlePromise: Promise<RecipeBundle> | null = null;
let recipesByOutput: Record<string, Recipe[]> = {};
let defaultRaw = new Set<string>();
const unresolvedKinds = new Set<string>();

// Finished blocks players almost always stock as the block itself rather than
// re-deriving them from a recipe every time (glass is kept as glass, not smelted
// from sand). They still have recipes, so the calculator can break them down on
// request, but they count as a base material until the user asks otherwise.
const defaultBaseMaterials = new Set<string>([
  'glass',
  'tinted_glass',
]);

export function loadRecipeBundle(): Promise<RecipeBundle> {
  recipeBundlePromise ??= import('./data/recipes.generated.json').then((module) => {
    recipeBundle = module.default as unknown as RecipeBundle;
    recipesByOutput = recipeBundle.recipes;
    defaultRaw = new Set(recipeBundle.raw);
    return recipeBundle;
  });
  return recipeBundlePromise;
}

export function getRecipeBundle(): RecipeBundle | null {
  return recipeBundle;
}

export const defaultRecipeTypePreference: RecipeType[] = [
  'stonecutting',
  'crafting_shaped',
  'crafting_shapeless',
  'smelting',
  'blasting',
  'smoking',
  'campfire_cooking',
];

export function getRecipes(itemId: string): Recipe[] {
  return recipesByOutput[normalizeRecipeItemId(itemId)] ?? [];
}

export function isRawByDefault(itemId: string): boolean {
  const id = normalizeRecipeItemId(itemId);
  return defaultRaw.has(id) || defaultBaseMaterials.has(id) || isNaturallyGathered(id);
}

/** True when the calculator can break this item down into a recipe of its own. */
export function canBreakDown(itemId: string): boolean {
  return getRecipes(itemId).length > 0;
}

/** Index of the recipe the calculator would use for an item, honoring the user's pick. */
export function chooseRecipeIndex(itemId: string, opts: BreakdownOptions): number {
  const id = normalizeRecipeItemId(itemId);
  const recipes = getRecipes(id);
  if (recipes.length === 0) return -1;

  const explicitChoice = opts.recipeChoice.get(id);
  if (explicitChoice !== undefined && recipes[explicitChoice]) return explicitChoice;

  let bestIndex = 0;
  for (let index = 1; index < recipes.length; index += 1) {
    if (compareRecipes(recipes[index], recipes[bestIndex], opts) < 0) bestIndex = index;
  }
  return bestIndex;
}

export function chooseRecipe(itemId: string, opts: BreakdownOptions): Recipe | undefined {
  const index = chooseRecipeIndex(itemId, opts);
  return index < 0 ? undefined : getRecipes(itemId)[index];
}

export function explodeMaterials(top: MaterialLike[], opts: BreakdownOptions): BreakdownResult {
  const rawTotals = new Map<string, number>();
  const trees: BreakdownNode[] = [];
  unresolvedKinds.clear();

  const resolve = (itemId: string, quantity: number, visited: Set<string>): BreakdownNode => {
    const id = normalizeRecipeItemId(itemId);
    const owned = opts.owned?.get(id) ?? 0;
    const neededQuantity = Math.max(0, quantity - owned);
    const recipes = getRecipes(id);
    const canCraft = recipes.length > 0 && !visited.has(id);
    const forcedCraft = canCraft && (opts.craftOverrides?.has(id) ?? false);
    const isRaw = !forcedCraft && (opts.rawOverrides.has(id) || isRawByDefault(id) || !canCraft);

    if (isRaw) {
      rawTotals.set(id, (rawTotals.get(id) ?? 0) + neededQuantity);
      if (recipes.length === 0 && !opts.rawOverrides.has(id) && !isRawByDefault(id)) unresolvedKinds.add(id);
      return { id, count: neededQuantity, isRaw: true, children: [] };
    }

    const recipe = chooseRecipe(id, opts);
    if (!recipe) {
      rawTotals.set(id, (rawTotals.get(id) ?? 0) + neededQuantity);
      unresolvedKinds.add(id);
      return { id, count: neededQuantity, isRaw: true, children: [] };
    }

    const crafts = opts.integerCrafting ? Math.ceil(neededQuantity / recipe.output) : neededQuantity / recipe.output;
    const nextVisited = new Set(visited);
    nextVisited.add(id);
    const children = Object.entries(recipe.inputs)
      .map(([inputId, perCraft]) => resolve(inputId, crafts * perCraft, nextVisited))
      .filter((child) => child.count > 0);

    return {
      id,
      count: neededQuantity,
      isRaw: false,
      recipeUsed: recipe,
      children,
      surplus: opts.integerCrafting ? crafts * recipe.output - neededQuantity : 0,
    };
  };

  for (const material of top) {
    if (material.count <= 0) continue;
    trees.push(resolve(material.id, material.count, new Set()));
  }

  return {
    raw: Array.from(rawTotals.entries())
      .filter(([, count]) => count > 0)
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    trees,
    unresolved: Array.from(unresolvedKinds).sort(),
  };
}

export function recipeTypeLabel(type: RecipeType): string {
  switch (type) {
    case 'crafting_shaped':
    case 'crafting_shapeless':
      return 'Craft';
    case 'stonecutting':
      return 'Stonecut';
    case 'smelting':
      return 'Smelt';
    case 'blasting':
      return 'Blast';
    case 'smoking':
      return 'Smoke';
    case 'campfire_cooking':
      return 'Cook';
  }
}

export function normalizeRecipeItemId(itemId: string): string {
  return itemId.replace(/^minecraft:/, '').split('[', 1)[0];
}

function compareRecipes(a: Recipe, b: Recipe, opts: BreakdownOptions): number {
  return (
    recipePreferenceRank(a.type, opts.recipeTypePreference) - recipePreferenceRank(b.type, opts.recipeTypePreference)
      || rawInputScore(b, opts) - rawInputScore(a, opts)
      || Object.keys(a.inputs).length - Object.keys(b.inputs).length
      || a.output - b.output
  );
}

function recipePreferenceRank(type: RecipeType, preference: RecipeType[]): number {
  const rank = preference.indexOf(type);
  return rank >= 0 ? rank : preference.length;
}

function rawInputScore(recipe: Recipe, opts: BreakdownOptions): number {
  return Object.keys(recipe.inputs).filter((id) => opts.rawOverrides.has(id) || isRawByDefault(id)).length;
}

function isNaturallyGathered(id: string): boolean {
  return /(^|_)(ore|log|wood|stem|hyphae|leaves|sapling|coral|coral_fan|flower|tulip|orchid|allium|bluet|daisy|dandelion|poppy|mushroom|fungus|roots|vines|vine|kelp|seagrass|bush|fern|grass|cactus|sugar_cane|bamboo|amethyst|dripstone|obsidian|bedrock)$/.test(id);
}
