import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { MealDbSearch } from '@/components/MealDbSearch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, previewImport } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ImportPreview } from '@/lib/types';
import { useDocumentTitle } from '@/lib/use-document-title';

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Importing from a link is turned off on this server.';
    return err.message;
  }
  return 'Could not reach the server. Is it running?';
}

export function ImportPage() {
  useDocumentTitle('Import a recipe');
  const navigate = useNavigate();
  const { features } = useAuth();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<ImportPreview | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Stop waiting for the server if the user leaves the page.
  useEffect(() => () => controller.current?.abort(), []);

  function openForm(preview: ImportPreview) {
    navigate('/recipes/new', { state: { importPreview: preview } });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDuplicate(null);

    const address = url.trim();
    if (!address) {
      setError('Paste a recipe link first.');
      return;
    }

    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;

    setBusy(true);
    try {
      const preview = await previewImport(address, current.signal);
      if (preview.existingRecipeId !== null) {
        setDuplicate(preview);
      } else {
        openForm(preview);
      }
    } catch (err) {
      if (!current.signal.aborted) setError(messageFor(err));
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Import a recipe</h1>
        <p className="text-sm text-muted-foreground">
          Paste the link to a recipe page. You can review and change everything before it is saved.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-3" aria-busy={busy}>
        <div className="space-y-2">
          <Label htmlFor="import-url">Recipe link</Label>
          <div className="flex gap-2">
            <Input
              id="import-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              maxLength={2048}
              placeholder="https://..."
              autoComplete="off"
              aria-describedby={error ? 'import-error' : undefined}
              aria-invalid={error !== null}
            />
            <Button type="submit" disabled={busy}>
              {busy ? 'Reading...' : 'Import'}
            </Button>
          </div>
        </div>

        {error && (
          <p id="import-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>

      {duplicate && duplicate.existingRecipeId !== null && (
        <div role="status" className="space-y-3 rounded-lg border p-4">
          <p className="text-sm">
            You already have a recipe saved from this link:{' '}
            <Link to={`/recipes/${duplicate.existingRecipeId}`} className="font-medium underline">
              open it
            </Link>
            .
          </p>
          <Button type="button" variant="outline" onClick={() => openForm(duplicate)}>
            Import anyway
          </Button>
        </div>
      )}

      {features.mealdb && <MealDbSearch onReview={openForm} />}

      <p className="text-xs text-muted-foreground">
        Works with pages that publish standard recipe data, which most recipe sites do. The server fetches the page for
        you; recipes stay on your machine and belong to their original authors.
      </p>
    </div>
  );
}
