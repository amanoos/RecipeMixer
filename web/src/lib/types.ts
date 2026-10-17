export interface RecipeSummary {
  id: number;
  title: string;
  cuisine: string | null;
  rating: number | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeDetail extends RecipeSummary {
  description: string | null;
  sourceUrl: string | null;
  ingredients: string[];
  steps: string[];
}

export interface RecipeInput {
  title: string;
  cuisine: string | null;
  description: string | null;
  sourceUrl: string | null;
  rating: number | null;
  ingredients: string[];
  steps: string[];
}

export interface RecipeList {
  items: RecipeSummary[];
  total: number;
}

export type SortOrder = 'relevance' | 'newest' | 'rating' | 'title';

export interface Cuisine {
  name: string;
  count: number;
}

export interface MatchItem {
  recipe: RecipeSummary;
  matchedCount: number;
  totalCount: number;
  /** matchedCount / totalCount, between 0 and 1. */
  coverage: number;
  matched: string[];
  /** The recipe's own ingredient lines the user still needs. */
  missing: string[];
}

export interface MatchResult {
  items: MatchItem[];
  /** Number of matching recipes before pagination. */
  total: number;
  usedIngredients: string[];
  /** Inputs that did not look like an ingredient and were skipped. */
  ignored: string[];
  assumeStaples: boolean;
}

export interface IngredientSuggestion {
  name: string;
  count: number;
}
