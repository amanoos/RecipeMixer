import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { RecipeCard } from '@/components/RecipeCard';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { listRecipes } from '@/lib/api';
import type { RecipeSummary } from '@/lib/types';

const PAGE_SIZE = 24;

export function RecipeListPage() {
  const [items, setItems] = useState<RecipeSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadFirstPage = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setFailed(false);
    listRecipes({ limit: PAGE_SIZE, offset: 0, signal })
      .then((page) => {
        setItems(page.items);
        setTotal(page.total);
      })
      .catch(() => {
        if (!signal?.aborted) setFailed(true);
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadFirstPage(controller.signal);
    return () => controller.abort();
  }, [loadFirstPage]);

  function loadMore() {
    setLoadingMore(true);
    listRecipes({ limit: PAGE_SIZE, offset: items.length })
      .then((page) => {
        setItems((current) => [...current, ...page.items]);
        setTotal(page.total);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoadingMore(false));
  }

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading recipes">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-64 w-full" />
        ))}
      </div>
    );
  }

  if (failed && items.length === 0) {
    return (
      <div role="alert" className="space-y-3 text-center">
        <p>Could not load your recipes. Is the server running?</p>
        <Button variant="outline" onClick={() => loadFirstPage()}>
          Try again
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-3 py-16 text-center">
        <h1 className="text-xl font-semibold">No recipes yet</h1>
        <p className="text-muted-foreground">Save your first recipe to start your collection.</p>
        <Link to="/recipes/new" className={buttonVariants()}>
          Add your first recipe
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Your recipes</h1>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((recipe) => (
          <li key={recipe.id}>
            <RecipeCard recipe={recipe} />
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
  );
}
