import { ImageOff } from 'lucide-react';

/** How eagerly a card's photo is fetched: the first row is needed for the first paint, the rest can wait. */
export type ImagePriority = 'high' | 'eager' | 'lazy';

/** The first card's photo is usually the largest thing on screen, so it is fetched first. */
export function imagePriority(index: number): ImagePriority {
  if (index === 0) return 'high';
  return index < 3 ? 'eager' : 'lazy';
}

/** A card's 4:3 photo, or a same-sized placeholder, so the layout does not move when photos arrive. */
export function CardImage({ src, priority = 'lazy' }: { src: string | null; priority?: ImagePriority }) {
  if (!src) {
    return (
      <div
        data-slot="card-image"
        className="flex aspect-[4/3] w-full items-center justify-center bg-muted text-muted-foreground"
      >
        <ImageOff aria-hidden="true" className="size-8" />
      </div>
    );
  }
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
