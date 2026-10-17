import { Check, ImageOff } from 'lucide-react';
import { Link } from 'react-router';
import { StarRating } from '@/components/StarRating';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { MatchItem } from '@/lib/types';

const MAX_MISSING_SHOWN = 5;

/** A recipe the user can make (or nearly make) from their ingredients, with what is still missing. */
export function MatchCard({ item }: { item: MatchItem }) {
  const { recipe, matchedCount, totalCount, missing } = item;
  const complete = missing.length === 0;
  const shown = missing.slice(0, MAX_MISSING_SHOWN);
  const more = missing.length - shown.length;

  return (
    <Link
      to={`/recipes/${recipe.id}`}
      className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
        {recipe.imageUrl ? (
          <img src={recipe.imageUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted text-muted-foreground">
            <ImageOff aria-hidden="true" className="size-8" />
          </div>
        )}
        <CardContent className="space-y-2 pt-4">
          <h2 className="line-clamp-2 font-medium">{recipe.title}</h2>
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
