import { useEffect, useId, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { suggestIngredients } from '@/lib/api';
import type { IngredientSuggestion } from '@/lib/types';

// These mirror the server's limits.
export const MAX_INGREDIENTS = 30;
export const MAX_INGREDIENT_LENGTH = 60;

const SUGGEST_DELAY_MS = 200;
const MIN_SUGGEST_LENGTH = 2;

interface IngredientChipsProps {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  /** Where suggestions come from; replaceable so the component can be tested without a server. */
  suggest?: (prefix: string, signal: AbortSignal) => Promise<IngredientSuggestion[]>;
}

/** A text box that turns each typed ingredient (Enter or comma) into a removable chip. */
export function IngredientChips({ value, onChange, max = MAX_INGREDIENTS, suggest = suggestIngredients }: IngredientChipsProps) {
  const inputId = useId();
  const listId = useId();
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Debounced, abortable suggestions from the user's own recipes. They are a convenience, so failures are ignored.
  useEffect(() => {
    const prefix = draft.trim();
    if (prefix.length < MIN_SUGGEST_LENGTH) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      suggest(prefix, controller.signal)
        .then((items) => {
          if (!controller.signal.aborted) setSuggestions(items.map((item) => item.name));
        })
        .catch(() => {
          // Suggestions are optional; typing and searching work without them.
        });
    }, SUGGEST_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, suggest]);

  function commit(texts: string[]) {
    const next = [...value];
    let message: string | null = null;
    for (const raw of texts) {
      const text = raw.trim();
      if (!text) continue;
      if (text.length > MAX_INGREDIENT_LENGTH) {
        message = `An ingredient can be at most ${MAX_INGREDIENT_LENGTH} characters.`;
        continue;
      }
      if (next.some((item) => item.toLowerCase() === text.toLowerCase())) continue;
      if (next.length >= max) {
        message = `You can add up to ${max} ingredients.`;
        break;
      }
      next.push(text);
    }
    setNotice(message);
    if (next.length !== value.length) onChange(next);
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const text = event.target.value;
    if (!text.includes(',')) {
      setDraft(text);
      return;
    }
    // A comma (typed or in a pasted list) finishes every entry before it.
    const parts = text.split(',');
    commit(parts.slice(0, -1));
    setDraft(parts[parts.length - 1] ?? '');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit([draft]);
      setDraft('');
    } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function handleBlur() {
    if (draft.trim()) {
      commit([draft]);
      setDraft('');
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>Ingredients you have</Label>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 focus-within:ring-3 focus-within:ring-ring/50">
        {value.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 rounded-full bg-secondary py-1 pr-1 pl-3 text-sm text-secondary-foreground"
          >
            {item}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              onClick={() => onChange(value.filter((existing) => existing !== item))}
              className="rounded-full p-0.5 pointer-coarse:p-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          list={listId}
          value={draft}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          autoComplete="off"
          aria-describedby={`${inputId}-help`}
          placeholder={value.length === 0 ? 'chicken, rice, spinach...' : ''}
          className="min-w-40 flex-1 bg-transparent px-1 py-1 pointer-coarse:py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <datalist id={listId}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      <p id={`${inputId}-help`} className="text-xs text-muted-foreground">
        Type an ingredient and press Enter or a comma. Backspace removes the last one.
      </p>
      {notice && (
        <p role="alert" className="text-sm text-destructive">
          {notice}
        </p>
      )}
    </div>
  );
}
