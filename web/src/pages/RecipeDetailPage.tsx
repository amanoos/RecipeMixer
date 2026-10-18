import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ImageOff, Pencil, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StarRating } from '@/components/StarRating';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, deleteRecipe, getRecipe, setRating } from '@/lib/api';
import { displayTitle } from '@/lib/display-title';
import type { RecipeDetail } from '@/lib/types';
import { useDocumentTitle } from '@/lib/use-document-title';

// Only real web links are rendered as links; anything else is shown as plain text.
const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

export function RecipeDetailPage() {
  const { id } = useParams();
  const recipeId = Number(id);
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  useDocumentTitle(recipe ? displayTitle(recipe.title) : (state === 'missing' ? 'Recipe not found' : 'Recipe'));

  useEffect(() => {
    if (!Number.isInteger(recipeId) || recipeId < 1) {
      setState('missing');
      return;
    }
    const controller = new AbortController();
    setState('loading');
    getRecipe(recipeId, controller.signal)
      .then((loaded) => {
        setRecipe(loaded);
        setState('ready');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'error');
      });
    return () => controller.abort();
  }, [recipeId]);

  async function handleDelete() {
    try {
      await deleteRecipe(recipeId);
      navigate('/');
    } catch {
      setConfirming(false);
      setDeleteError('Could not delete the recipe. Please try again.');
    }
  }

  // Saved immediately; the stars change at once and go back if the save fails.
  async function handleRate(next: number | null) {
    if (!recipe) return;
    const previous = recipe.rating;
    setRatingError(null);
    setRecipe({ ...recipe, rating: next });
    try {
      await setRating(recipe.id, next);
    } catch {
      setRecipe((current) => (current ? { ...current, rating: previous } : current));
      setRatingError('Could not save your rating. Please try again.');
    }
  }

  if (state === 'loading') {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading recipe">
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="aspect-[4/3] w-full rounded-xl" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (state === 'missing') {
    return (
      <div className="space-y-3 py-16 text-center">
        <h1 className="text-xl font-semibold">Recipe not found</h1>
        <Link to="/" className={buttonVariants({ variant: 'outline' })}>
          Back to your recipes
        </Link>
      </div>
    );
  }

  if (state === 'error' || !recipe) {
    return (
      <p role="alert" className="text-center">
        Could not load this recipe. Is the server running?
      </p>
    );
  }

  return (
    <article className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        {recipe.imageUrl ? (
          <img
            src={recipe.imageUrl}
            alt={`Photo of ${displayTitle(recipe.title)}`}
            width={800}
            height={600}
            fetchPriority="high"
            className="aspect-[4/3] w-full rounded-xl object-cover"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <ImageOff aria-hidden="true" className="size-10" />
          </div>
        )}

        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">{displayTitle(recipe.title)}</h1>
          <div className="flex flex-wrap items-center gap-3">
            {recipe.cuisine && <Badge variant="secondary">{recipe.cuisine}</Badge>}
            <span className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Your rating</span>
              <StarRating value={recipe.rating} onChange={handleRate} />
            </span>
          </div>
          {ratingError && (
            <p role="alert" className="text-sm text-destructive">
              {ratingError}
            </p>
          )}
          {recipe.description && <p className="whitespace-pre-line text-muted-foreground">{recipe.description}</p>}
          {recipe.sourceUrl && (
            <p className="text-sm">
              Source:{' '}
              {isHttpUrl(recipe.sourceUrl) ? (
                <a
                  href={recipe.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-primary underline-offset-4 hover:underline"
                >
                  {recipe.sourceUrl}
                </a>
              ) : (
                <span className="break-all">{recipe.sourceUrl}</span>
              )}
            </p>
          )}
          <div className="flex gap-2">
            <Link to={`/recipes/${recipe.id}/edit`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil aria-hidden="true" />
              Edit
            </Link>
            <Button variant="destructive" onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </div>
          {confirming && (
            <ConfirmDialog
              title="Delete this recipe?"
              description="This permanently deletes the recipe and its image. This cannot be undone."
              confirmLabel="Delete recipe"
              onConfirm={handleDelete}
              onCancel={() => setConfirming(false)}
            />
          )}
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
        </div>
      </div>

      {recipe.ingredients.length > 0 && (
        <section aria-labelledby="ingredients-heading" className="space-y-2">
          <h2 id="ingredients-heading" className="text-lg font-semibold">
            Ingredients
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            {recipe.ingredients.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {recipe.steps.length > 0 && (
        <section aria-labelledby="steps-heading" className="space-y-2">
          <h2 id="steps-heading" className="text-lg font-semibold">
            Steps
          </h2>
          <ol className="list-decimal space-y-2 pl-5">
            {recipe.steps.map((line, index) => (
              <li key={index} className="whitespace-pre-line">
                {line}
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
