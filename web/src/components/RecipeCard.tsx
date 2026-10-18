import { Link } from 'react-router';
import { CardImage, type ImagePriority } from '@/components/CardImage';
import { StarRating } from '@/components/StarRating';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { displayTitle } from '@/lib/display-title';
import type { RecipeSummary } from '@/lib/types';

export function RecipeCard({ recipe, priority = 'lazy' }: { recipe: RecipeSummary; priority?: ImagePriority }) {
  return (
    <Link
      to={`/recipes/${recipe.id}`}
      className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full overflow-hidden transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md">
        <CardImage src={recipe.imageUrl} priority={priority} seed={recipe.title} />
        <CardContent className="flex flex-1 flex-col gap-2 pt-4">
          <h2 className="line-clamp-2 min-h-[2lh] font-medium">{displayTitle(recipe.title)}</h2>
          <div className="mt-auto flex items-center justify-between gap-2">
            {recipe.cuisine ? <Badge variant="secondary">{recipe.cuisine}</Badge> : <span />}
            <StarRating value={recipe.rating} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
