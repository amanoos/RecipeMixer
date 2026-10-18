import { Check } from 'lucide-react';
import { Link } from 'react-router';
import { CardImage, type ImagePriority } from '@/components/CardImage';
import { StarRating } from '@/components/StarRating';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { displayTitle } from '@/lib/display-title';
import type { MatchItem } from '@/lib/types';

const MAX_MISSING_SHOWN = 5;

/** A recipe the user can make (or nearly make) from their ingredients, with what is still missing. */
export function MatchCard({ item, priority = 'lazy' }: { item: MatchItem; priority?: ImagePriority }) {
  const { recipe, matchedCount, totalCount, missing } = item;
  const complete = missing.length === 0;
  const shown = missing.slice(0, MAX_MISSING_SHOWN);
  const more = missing.length - shown.length;

  return (
    <Link
      to={`/recipes/${recipe.id}`}
      className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full overflow-hidden transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md">
        <CardImage src={recipe.imageUrl} priority={priority} seed={recipe.title} />
        <CardContent className="flex flex-1 flex-col gap-2 pt-4">
          <h2 className="line-clamp-2 min-h-[2lh] font-medium">{displayTitle(recipe.title)}</h2>
          <div className="flex items-center justify-between gap-2">
            <Badge variant={complete ? 'default' : 'secondary'}>
              {complete && <Check aria-hidden="true" />}
              You have {matchedCount} of {totalCount}
            </Badge>
            <StarRating value={recipe.rating} />
          </div>
          {complete ? (
            <p className="text-sm text-muted-foreground">You have everything.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Missing: {shown.join('; ')}
              {more > 0 && ` +${more} more`}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
