import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChefHat, Search, SearchX } from 'lucide-react';
import { CardGridSkeleton } from '@/components/CardGridSkeleton';
import { imagePriority } from '@/components/CardImage';
import { RecipeCard } from '@/components/RecipeCard';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { listCuisines, listRecipes, loadStarterRecipes } from '@/lib/api';
import type { Cuisine, RecipeSummary, SortOrder } from '@/lib/types';
import { useDocumentTitle } from '@/lib/use-document-title';

const PAGE_SIZE = 24;
const SEARCH_DELAY_MS = 300;
const SORTS: SortOrder[] = ['relevance', 'newest', 'rating', 'title'];
const RATING_CHOICES = [2, 3, 4, 5];

const SELECT_CLASS =
  'h-8 rounded-lg border pointer-coarse:h-11 border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

interface Filters {
  q: string;
  cuisine: string;
  minRating: number | undefined;
  sort: SortOrder | undefined;
}

/** Reads the filters from the URL, ignoring anything the server would reject. */
function readFilters(params: URLSearchParams): Filters {
  const rating = Number(params.get('minRating'));
  const sort = params.get('sort');
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    cuisine: (params.get('cuisine') ?? '').trim().slice(0, 80),
    minRating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
    sort: SORTS.includes(sort as SortOrder) ? (sort as SortOrder) : undefined,
  };
}

const hasAnyFilter = (filters: Filters): boolean =>
  filters.q !== '' || filters.cuisine !== '' || filters.minRating !== undefined || filters.sort !== undefined;

/**
 * The recipe collection with search, cuisine and rating filters and sorting. All of it lives in the URL
 * (?q=tomato&cuisine=Italian&minRating=4&sort=rating) so it survives a refresh and the back button.
 */
export function RecipeListPage() {
  useDocumentTitle('Your recipes');
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const [text, setText] = useState(filters.q);
  const [cuisines, setCuisines] = useState<Cuisine[]>([]);

  const [items, setItems] = useState<RecipeSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loadingStarter, setLoadingStarter] = useState(false);
  const [starterError, setStarterError] = useState(false);

  function updateParams(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  // The cuisine menu is a convenience; the page works without it.
  useEffect(() => {
    const controller = new AbortController();
    listCuisines(controller.signal)
      .then(setCuisines)
      .catch(() => {
        // No cuisine menu is better than an error banner.
      });
    return () => controller.abort();
  }, [retry]);

  // Keep the box in step when the URL changes from elsewhere (Clear filters, the back button).
  useEffect(() => {
    setText(filters.q);
  }, [filters.q]);

  // Search as you type, after a short pause, by moving the text into the URL.
  useEffect(() => {
    const timer = setTimeout(() => {
      const wanted = text.trim();
      if (wanted !== filters.q) updateParams({ q: wanted || undefined });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, filters.q]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    listRecipes({
      limit: PAGE_SIZE,
      offset: 0,
      q: filters.q || undefined,
      cuisine: filters.cuisine || undefined,
      minRating: filters.minRating,
      sort: filters.sort,
      signal: controller.signal,
    })
      .then((page) => {
        setItems(page.items);
        setTotal(page.total);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, retry]);

  function loadMore() {
    setLoadingMore(true);
    listRecipes({
      limit: PAGE_SIZE,
      offset: items.length,
      q: filters.q || undefined,
      cuisine: filters.cuisine || undefined,
      minRating: filters.minRating,
      sort: filters.sort,
    })
      .then((page) => {
        setItems((current) => [...current, ...page.items]);
        setTotal(page.total);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoadingMore(false));
  }

  async function handleLoadStarter() {
    setStarterError(false);
    setLoadingStarter(true);
    try {
      await loadStarterRecipes();
      // Reload the list and the cuisine menu, which now have content.
      setRetry((count) => count + 1);
    } catch {
      setStarterError(true);
    } finally {
      setLoadingStarter(false);
    }
  }

  function clearFilters() {
    setText('');
    setParams(new URLSearchParams(), { replace: true });
  }

  const filtered = hasAnyFilter(filters);
  const libraryEmpty = !loading && !failed && !filtered && total === 0;
  const defaultSort: SortOrder = filters.q ? 'relevance' : 'newest';
  const sortValue = filters.sort === 'relevance' && !filters.q ? 'newest' : (filters.sort ?? defaultSort);
  const cuisineNames = cuisines.map((cuisine) => cuisine.name);
  if (filters.cuisine && !cuisineNames.some((name) => name.toLowerCase() === filters.cuisine.toLowerCase())) {
    cuisineNames.push(filters.cuisine);
  }
  const selectedCuisine = cuisineNames.find((name) => name.toLowerCase() === filters.cuisine.toLowerCase()) ?? '';

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Your recipes</h1>

      {!libraryEmpty && (
        <div className="space-y-3">
          <div className="relative">
            <Label htmlFor="recipe-search" className="sr-only">
              Search recipes
            </Label>
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="recipe-search"
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={100}
              autoComplete="off"
              placeholder="Search recipes, cuisines, ingredients..."
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="filter-cuisine">Cuisine</Label>
              <select
                id="filter-cuisine"
                value={selectedCuisine}
                onChange={(event) => updateParams({ cuisine: event.target.value || undefined })}
                className={SELECT_CLASS}
              >
                <option value="">All cuisines</option>
                {cuisineNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="filter-rating">Rating</Label>
              <select
                id="filter-rating"
                value={filters.minRating === undefined ? '' : String(filters.minRating)}
                onChange={(event) => updateParams({ minRating: event.target.value || undefined })}
                className={SELECT_CLASS}
              >
                <option value="">Any rating</option>
                {RATING_CHOICES.map((rating) => (
                  <option key={rating} value={rating}>
                    {rating === 5 ? '5 stars' : `${rating} stars and up`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="filter-sort">Sort by</Label>
              <select
                id="filter-sort"
                value={sortValue}
                onChange={(event) => updateParams({ sort: event.target.value })}
                className={SELECT_CLASS}
              >
                {filters.q && <option value="relevance">Best match</option>}
                <option value="newest">Newest first</option>
                <option value="rating">Highest rated</option>
                <option value="title">Title A to Z</option>
              </select>
            </div>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <CardGridSkeleton label="Loading recipes" />
      ) : failed && items.length === 0 ? (
        <div role="alert" className="space-y-3 text-center">
          <p>Could not load your recipes. Is the server running?</p>
          <Button variant="outline" onClick={() => setRetry((count) => count + 1)}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 && !filtered ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <ChefHat aria-hidden="true" className="size-10 text-primary" />
          <h2 className="text-xl font-semibold">No recipes yet</h2>
          <p className="text-muted-foreground">Save your first recipe to start your collection.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/recipes/new" className={buttonVariants()}>
              Add your first recipe
            </Link>
            <Button variant="outline" disabled={loadingStarter} onClick={() => void handleLoadStarter()}>
              {loadingStarter ? 'Loading...' : 'Load starter recipes'}
            </Button>
          </div>
          <p className="max-w-md text-sm text-muted-foreground">
            Or try the app with about forty simple starter recipes. They are free for anyone to use and you can delete
            them any time.
          </p>
          {starterError && (
            <p role="alert" className="text-sm text-destructive">
              Could not load the starter recipes. Is the server running?
            </p>
          )}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <SearchX aria-hidden="true" className="size-8 text-muted-foreground" />
          <h2 className="text-lg font-semibold">No recipes match your search</h2>
          <p className="text-muted-foreground">Try different words, or clear the filters.</p>
          <Button variant="outline" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {filtered && (
            <p role="status" className="text-sm text-muted-foreground">
              {total} {total === 1 ? 'recipe' : 'recipes'}
              {filters.q ? ` for "${filters.q}"` : ''}
            </p>
          )}
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((recipe, index) => (
              <li key={recipe.id}>
                <RecipeCard recipe={recipe} priority={imagePriority(index)} />
              </li>
            ))}
          </ul>
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">
              Showing {items.length} of {total}
            </p>
            {failed && (
              <p role="alert" className="text-sm text-destructive">
                Could not load more recipes.
              </p>
            )}
            {items.length < total && (
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : 'Load more'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
