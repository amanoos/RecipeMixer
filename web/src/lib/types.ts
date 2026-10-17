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
