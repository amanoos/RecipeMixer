import { Skeleton } from '@/components/ui/skeleton';

const PLACEHOLDERS = [0, 1, 2, 3, 4, 5];

/**
 * The loading state of a grid of recipe cards. It has the same shape and enough cards to fill the
 * first screen, so the page does not jump (and push the footer away) when the real cards arrive.
 */
export function CardGridSkeleton({ label }: { label: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label={label}>
      {PLACEHOLDERS.map((n) => (
        <div key={n} className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
