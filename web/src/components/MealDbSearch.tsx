import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, previewMealDb, searchMealDb } from '@/lib/api';
import type { ImportPreview, MealSearchResult } from '@/lib/types';

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404 && err.message === 'Not Found') return 'The TheMealDB search is turned off on this server.';
    return err.message;
  }
  return 'Could not reach the server. Is it running?';
}

/**
 * Optional search of TheMealDB. A result is read into the same review form a link import uses, so nothing is saved
 * until the user has looked at it. Shown only when the server has the feature switched on.
 */
export function MealDbSearch({ onReview }: { onReview: (preview: ImportPreview) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MealSearchResult[] | null>(null);
  const [searchedFor, setSearchedFor] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<ImportPreview | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Stop waiting for the server if the user leaves the page.
  useEffect(() => () => controller.current?.abort(), []);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDuplicate(null);

    const text = query.trim();
    if (text.length < 2) {
      setError('Type at least two letters of a recipe name.');
      return;
    }

    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setSearching(true);
    try {
      const items = await searchMealDb(text, current.signal);
      if (current.signal.aborted) return;
      setResults(items);
      setSearchedFor(text);
    } catch (err) {
      if (!current.signal.aborted) setError(messageFor(err));
    } finally {
      if (!current.signal.aborted) setSearching(false);
    }
  }

  async function handleReview(id: string) {
    setError(null);
    setDuplicate(null);
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusyId(id);
    try {
      const preview = await previewMealDb(id, current.signal);
      if (current.signal.aborted) return;
      if (preview.existingRecipeId !== null) setDuplicate(preview);
      else onReview(preview);
    } catch (err) {
      if (!current.signal.aborted) setError(messageFor(err));
    } finally {
      if (!current.signal.aborted) setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="mealdb-heading" className="space-y-3 border-t pt-5">
      <div className="space-y-1">
        <h2 id="mealdb-heading" className="text-lg font-semibold">
          Find on TheMealDB
        </h2>
        <p className="text-sm text-muted-foreground">Search recipes by name, then review one before it is saved.</p>
      </div>

      <form onSubmit={handleSearch} noValidate className="space-y-2" aria-busy={searching}>
        <Label htmlFor="mealdb-query">Recipe name</Label>
        <div className="flex gap-2">
          <Input
            id="mealdb-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={60}
            placeholder="e.g. arrabiata"
            autoComplete="off"
            aria-describedby={error ? 'mealdb-error' : undefined}
            aria-invalid={error !== null}
          />
          <Button type="submit" disabled={searching}>
            {searching ? 'Searching...' : 'Search'}
          </Button>
        </div>
      </form>

      {error && (
        <p id="mealdb-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {results !== null && (
        <div role="status" className="space-y-2">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recipes found for &ldquo;{searchedFor}&rdquo;.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {results.length} {results.length === 1 ? 'recipe' : 'recipes'} for &ldquo;{searchedFor}&rdquo;
              </p>
              <ul className="divide-y rounded-lg border">
                {results.map((meal) => (
                  <li key={meal.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{meal.title}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {[meal.cuisine, meal.category].filter(Boolean).join(' · ') || 'No details'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyId !== null}
                      aria-label={`Review ${meal.title}`}
                      onClick={() => void handleReview(meal.id)}
                    >
                      {busyId === meal.id ? 'Reading...' : 'Review'}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {duplicate && duplicate.existingRecipeId !== null && (
        <div role="status" className="space-y-3 rounded-lg border p-4">
          <p className="text-sm">
            You already have a recipe saved from this page:{' '}
            <Link to={`/recipes/${duplicate.existingRecipeId}`} className="font-medium underline">
              open it
            </Link>
            .
          </p>
          <Button type="button" variant="outline" onClick={() => onReview(duplicate)}>
            Import anyway
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Recipes and photos come from{' '}
        <a href="https://www.themealdb.com" target="_blank" rel="noopener noreferrer" className="underline">
          TheMealDB
        </a>
        , a community database that is not open source. Its free key is for development and educational use, and its
        terms do not allow publishing an app to an app store without a paid subscription. A saved recipe keeps a link
        back to TheMealDB.
      </p>
    </section>
  );
}
