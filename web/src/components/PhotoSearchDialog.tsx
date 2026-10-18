import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, searchPhotos } from '@/lib/api';
import type { PhotoChoice } from '@/lib/types';

interface PhotoSearchDialogProps {
  /** The words to start with, usually the recipe title. Searched at once when long enough. */
  initialQuery: string;
  /** Called when a photo is picked. Reject to keep the dialog open and show the problem. */
  onChoose: (choice: PhotoChoice) => Promise<void> | void;
  onClose: () => void;
}

const MIN_QUERY = 2;

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404 && err.message === 'Not Found') return 'The photo search is turned off on this server.';
    if (err.status === 429) return 'Too many searches just now. Wait a moment and try again.';
    return err.message;
  }
  return 'Could not reach the server. Is it running?';
}

/**
 * Finds up to five photos for some words (usually a recipe's title) and lets the user pick one. A native <dialog>, like
 * the confirmation dialog: no inline styles, so it works under the strict Content-Security-Policy, and the browser
 * provides the focus trap and Escape handling. The pictures arrive inline from this app's own server.
 */
export function PhotoSearchDialog({ initialQuery, onChoose, onClose }: PhotoSearchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const headingId = useId();
  const noticeId = useId();

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<PhotoChoice[] | null>(null);
  const [searchedFor, setSearchedFor] = useState('');
  const [searching, setSearching] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(text: string) {
    const wanted = text.trim();
    if (wanted.length < MIN_QUERY) {
      setError('Type at least two letters to search for.');
      return;
    }

    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setError(null);
    setSearching(true);
    try {
      const items = await searchPhotos(wanted, current.signal);
      if (current.signal.aborted) return;
      setResults(items);
      setSearchedFor(wanted);
    } catch (err) {
      if (!current.signal.aborted) setError(messageFor(err));
    } finally {
      if (!current.signal.aborted) setSearching(false);
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    if (initialQuery.trim().length >= MIN_QUERY) void runSearch(initialQuery);
    return () => controller.current?.abort();
    // Runs once, when the dialog opens.
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void runSearch(query);
  }

  async function handleChoose(choice: PhotoChoice) {
    setError(null);
    setChoosing(choice.token);
    try {
      await onChoose(choice);
    } catch (err) {
      setError(messageFor(err));
      setChoosing(null);
    }
  }

  // Escape fires "cancel"; React state stays the single source of truth instead of the browser closing it.
  function handleCancelEvent(event: SyntheticEvent) {
    event.preventDefault();
    onClose();
  }

  // A click on the backdrop is delivered to the <dialog> element itself, not to its content.
  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      aria-describedby={noticeId}
      onCancel={handleCancelEvent}
      onClick={handleClick}
      className="m-auto max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-background p-5 text-foreground shadow-lg backdrop:bg-black/40"
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 id={headingId} className="text-xl font-semibold">
            Find a photo
          </h2>
          <p id={noticeId} className="text-sm text-muted-foreground">
            These words are sent to Wikimedia Commons and Openverse to look for openly licensed photos, and your server
            then downloads the previews from Wikimedia and Flickr. Nothing else leaves your computer. A photo you pick is
            saved with credit to its author.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-2" aria-busy={searching}>
          <Label htmlFor="photo-query">Search for</Label>
          <div className="flex gap-2">
            <Input
              id="photo-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={200}
              autoComplete="off"
              aria-describedby={error ? 'photo-error' : undefined}
              aria-invalid={error !== null}
            />
            <Button type="submit" disabled={searching || choosing !== null}>
              {searching ? 'Searching...' : 'Search'}
            </Button>
          </div>
        </form>

        {error && (
          <p id="photo-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div role="status" aria-live="polite">
          {searching && <p className="text-sm text-muted-foreground">Looking for photos...</p>}
          {!searching && results !== null && results.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No photos found for &ldquo;{searchedFor}&rdquo;. Try other words, or close this and upload a photo or paste a
              link.
            </p>
          )}
        </div>

        {!searching && results !== null && results.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((photo) => (
              <li key={photo.token} className="flex flex-col overflow-hidden rounded-lg border bg-card">
                <img
                  src={photo.thumbnail}
                  alt=""
                  width={360}
                  height={270}
                  className="aspect-[4/3] w-full bg-muted object-cover"
                />
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <p className="line-clamp-2 text-sm font-medium">{photo.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {[photo.creator ? `by ${photo.creator}` : null, photo.licence, photo.provider].filter(Boolean).join(' · ')}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={choosing !== null}
                      aria-label={`Use the photo ${photo.title}`}
                      onClick={() => void handleChoose(photo)}
                    >
                      {choosing === photo.token ? 'Saving...' : 'Use this photo'}
                    </Button>
                    {photo.landingUrl?.startsWith('https://') && (
                      <a
                        href={photo.landingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs underline"
                        aria-label={`Open the page of ${photo.title}`}
                      >
                        Photo page
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={choosing !== null}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}
