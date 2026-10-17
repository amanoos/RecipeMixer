import { ImageOff } from 'lucide-react';
import { Link } from 'react-router';
import { StarRating } from '@/components/StarRating';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { RecipeSummary } from '@/lib/types';

export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
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
            {recipe.cuisine ? <Badge variant="secondary">{recipe.cuisine}</Badge> : <span />}
            <StarRating value={recipe.rating} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
