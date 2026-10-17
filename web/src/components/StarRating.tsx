import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StarRatingProps {
  value: number | null;
  /** When provided the rating is editable; clicking the current value clears it. */
  onChange?: (value: number | null) => void;
}

const STARS = [1, 2, 3, 4, 5];

function StarIcon({ filled, interactive = false }: { filled: boolean; interactive?: boolean }) {
  return (
    <Star
      aria-hidden="true"
      className={cn('size-4', interactive && 'pointer-coarse:size-5', filled ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')}
    />
  );
}

export function StarRating({ value, onChange }: StarRatingProps) {
  if (!onChange) {
    return (
      <span
        role="img"
        aria-label={value ? `Rated ${value} out of 5` : 'Not rated'}
        className="inline-flex items-center gap-0.5"
      >
        {STARS.map((n) => (
          <StarIcon key={n} filled={value !== null && n <= value} />
        ))}
      </span>
    );
  }

  return (
    <div role="group" aria-label="Rating" className="inline-flex items-center gap-1">
      {STARS.map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`Rate ${n} out of 5`}
          aria-pressed={value === n}
          onClick={() => onChange(value === n ? null : n)}
          className="rounded p-0.5 pointer-coarse:p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <StarIcon filled={value !== null && n <= value} interactive />
        </button>
      ))}
    </div>
  );
}
