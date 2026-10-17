import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CookingPot } from 'lucide-react';
import { CardGridSkeleton } from '@/components/CardGridSkeleton';
import { imagePriority } from '@/components/CardImage';
import { IngredientChips } from '@/components/IngredientChips';
import { MatchCard } from '@/components/MatchCard';
import { Button, buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { matchRecipes } from '@/lib/api';
import type { MatchResult } from '@/lib/types';
import { useDocumentTitle } from '@/lib/use-document-title';

/**
 * "What can I cook?": the ingredients and the staples switch live in the URL (?i=chicken&i=rice&staples=0),
 * so a search survives going to a recipe and pressing back, and can be bookmarked.
 */
export function MatchPage() {
  useDocumentTitle('What can I cook?');
  const [params, setParams] = useSearchParams();
  const ingredients = useMemo(() => params.getAll('i'), [params]);
  const staples = params.get('staples') !== '0';

  const [result, setResult] = useState<MatchResult | null>(null);
  // A page opened with ingredients already in the address starts out loading, so it never flashes empty first.
  const [loading, setLoading] = useState(() => ingredients.length > 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (ingredients.length === 0) {
      setResult(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    matchRecipes({ ingredients, staples, signal: controller.signal })
      .then(setResult)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ingredients, staples, retry]);

  function updateSearch(nextIngredients: string[], nextStaples: boolean) {
    const next = new URLSearchParams();
    for (const ingredient of nextIngredients) next.append('i', ingredient);
    if (!nextStaples) next.set('staples', '0');
    setParams(next, { replace: true });
  }

  function loadMore() {
    if (!result) return;
    setLoadingMore(true);
    matchRecipes({ ingredients, staples, offset: result.items.length })
      .then((more) => setResult({ ...more, items: [...result.items, ...more.items] }))
      .catch(() => setFailed(true))
      .finally(() => setLoadingMore(false));
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">What can I cook?</h1>
        <p className="text-sm text-muted-foreground">
          Add what is in your fridge. Your recipes are ranked by how much of each you can already make.
        </p>
      </div>

      <IngredientChips value={ingredients} onChange={(next) => updateSearch(next, staples)} />

      <div className="flex items-center gap-2">
        <input
          id="assume-staples"
          type="checkbox"
          checked={staples}
          onChange={(event) => updateSearch(ingredients, event.target.checked)}
          className="size-4 accent-primary"
        />
        <Label htmlFor="assume-staples">Assume pantry staples (salt, pepper, water, oil)</Label>
      </div>

      <Results
        hasIngredients={ingredients.length > 0}
        result={result}
        loading={loading}
        loadingMore={loadingMore}
        failed={failed}
        onRetry={() => setRetry((count) => count + 1)}
        onLoadMore={loadMore}
      />
    </div>
  );
}

interface ResultsProps {
  hasIngredients: boolean;
  result: MatchResult | null;
  loading: boolean;
  loadingMore: boolean;
  failed: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
}

function Results({ hasIngredients, result, loading, loadingMore, failed, onRetry, onLoadMore }: ResultsProps) {
  if (!hasIngredients) {
    return (
      <p className="py-8 text-center text-muted-foreground">
        Add the ingredients you have and your best matching recipes will show up here.
      </p>
    );
  }

  if (loading) {
    return (
      <CardGridSkeleton label="Finding recipes" />
    );
  }

  if (failed && !result) {
    return (
      <div role="alert" className="space-y-3 text-center">
        <p>Could not search your recipes. Is the server running?</p>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="space-y-4">
      {result.ignored.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Skipped (not recognised as ingredients): {result.ignored.join(', ')}
        </p>
      )}

      {result.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CookingPot aria-hidden="true" className="size-8 text-muted-foreground" />
          <p className="font-medium">Nothing close yet.</p>
          <p className="text-sm text-muted-foreground">Try fewer ingredients, or add more recipes.</p>
          <Link to="/recipes/new" className={buttonVariants({ variant: 'outline' })}>
            Add a recipe
          </Link>
        </div>
      ) : (
        <>
          <h2 className="text-lg font-semibold">
            {result.total} {result.total === 1 ? 'recipe' : 'recipes'} you could make or nearly make
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((item, index) => (
              <li key={item.recipe.id}>
                <MatchCard item={item} priority={imagePriority(index)} />
              </li>
            ))}
          </ul>
          <div className="flex flex-col items-center gap-2">
            {failed && (
              <p role="alert" className="text-sm text-destructive">
                Could not load more recipes.
              </p>
            )}
            {result.items.length < result.total && (
              <Button variant="outline" onClick={onLoadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : 'Load more'}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
