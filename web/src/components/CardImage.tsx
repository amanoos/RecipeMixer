import { FoodArt } from '@/components/FoodArt';

/** How eagerly a card's photo is fetched: the first row is needed for the first paint, the rest can wait. */
export type ImagePriority = 'high' | 'eager' | 'lazy';

/** The first card's photo is usually the largest thing on screen, so it is fetched first. */
export function imagePriority(index: number): ImagePriority {
  if (index === 0) return 'high';
  return index < 3 ? 'eager' : 'lazy';
}

/**
 * A card's 4:3 photo, or a same-sized coloured drawing of some food (chosen from `seed`, usually the title), so the
 * layout does not move when photos arrive and a recipe without a photo is still nice to look at.
 */
export function CardImage({
  src,
  priority = 'lazy',
  seed = '',
}: {
  src: string | null;
  priority?: ImagePriority;
  seed?: string;
}) {
  if (!src) return <FoodArt seed={seed} className="aspect-[4/3] w-full" />;
  return (
    <img
      src={src}
      alt=""
      width={400}
      height={300}
      loading={priority === 'lazy' ? 'lazy' : 'eager'}
      fetchPriority={priority === 'high' ? 'high' : 'auto'}
      decoding="async"
      className="aspect-[4/3] w-full object-cover"
    />
  );
}
