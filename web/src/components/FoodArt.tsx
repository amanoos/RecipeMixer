import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Plain shapes drawn for this project, so a recipe without a photo still gets a colourful picture.
// Each is drawn in a 100 x 100 box; the main colour is `currentColor`, details are fixed.
const ARTS: ReactNode[] = [
  // tomato
  <g key="tomato">
    <circle cx="50" cy="57" r="31" fill="currentColor" />
    <ellipse cx="38" cy="45" rx="9" ry="6" fill="white" fillOpacity=".35" transform="rotate(-30 38 45)" />
    <path d="M50 28 L40 18 L50 22 L60 18 Z M50 28 L34 26 L44 32 Z M50 28 L66 26 L56 32 Z" fill="#4d7c0f" />
  </g>,
  // carrot
  <g key="carrot" transform="rotate(35 50 50)">
    <path d="M50 28 C66 28 72 38 69 50 L54 90 C52 95 48 95 46 90 L31 50 C28 38 34 28 50 28 Z" fill="currentColor" />
    <path d="M40 48 H52 M45 64 H56 M43 76 H50" stroke="white" strokeOpacity=".45" strokeWidth="3.5" strokeLinecap="round" />
    <path d="M50 30 C40 22 40 12 46 6 C52 12 52 22 50 30 Z M50 30 C50 18 56 10 64 8 C64 18 60 26 50 30 Z M50 30 C42 28 32 24 28 16 C38 14 46 20 50 30 Z" fill="#4d7c0f" />
  </g>,
  // lemon
  <g key="lemon">
    <path d="M14 55 Q28 24 52 27 Q84 28 88 52 Q80 80 50 79 Q22 80 14 55 Z" fill="currentColor" />
    <ellipse cx="40" cy="44" rx="10" ry="5" fill="white" fillOpacity=".4" transform="rotate(-20 40 44)" />
  </g>,
  // bell pepper
  <g key="pepper">
    <path d="M24 46 C22 30 38 26 50 34 C62 26 78 30 76 46 C80 66 72 88 50 88 C28 88 20 66 24 46 Z" fill="currentColor" />
    <path d="M36 44 C34 56 36 70 42 78" stroke="white" strokeOpacity=".4" strokeWidth="4" strokeLinecap="round" fill="none" />
    <path d="M45 34 C44 22 50 14 60 12 L61 19 C56 21 55 26 55 34 Z" fill="#4d7c0f" />
  </g>,
  // fried egg
  <g key="egg">
    <path d="M20 52 Q18 24 46 22 Q80 18 84 46 Q90 74 60 80 Q40 90 26 74 Q18 66 20 52 Z" fill="white" fillOpacity=".92" />
    <circle cx="52" cy="50" r="15" fill="currentColor" />
    <ellipse cx="47" cy="45" rx="4" ry="3" fill="white" fillOpacity=".5" />
  </g>,
  // herb leaf
  <g key="leaf">
    <path d="M18 82 Q10 30 68 18 Q84 72 18 82 Z" fill="currentColor" />
    <path d="M22 78 Q44 54 66 26" stroke="white" strokeOpacity=".5" strokeWidth="3" strokeLinecap="round" fill="none" />
  </g>,
  // mushroom
  <g key="mushroom">
    <path d="M12 56 Q12 18 50 18 Q88 18 88 56 Z" fill="currentColor" />
    <rect x="38" y="54" width="24" height="32" rx="10" fill="white" fillOpacity=".9" />
    <circle cx="34" cy="38" r="4" fill="white" fillOpacity=".5" />
    <circle cx="60" cy="32" r="3" fill="white" fillOpacity=".5" />
    <circle cx="70" cy="46" r="3" fill="white" fillOpacity=".5" />
  </g>,
  // steaming bowl
  <g key="bowl">
    <path d="M14 50 H86 Q86 86 50 86 Q14 86 14 50 Z" fill="currentColor" />
    <path d="M34 40 Q28 32 34 24 M50 40 Q44 30 50 20 M66 40 Q60 32 66 24" stroke="currentColor" strokeOpacity=".6" strokeWidth="4" strokeLinecap="round" fill="none" />
  </g>,
];

// Soft flat colours with enough contrast for the picture on its tile, in both themes.
const TILES = [
  'bg-red-100 text-red-500 dark:bg-red-950 dark:text-red-400',
  'bg-amber-100 text-amber-500 dark:bg-amber-950 dark:text-amber-400',
  'bg-lime-100 text-lime-600 dark:bg-lime-950 dark:text-lime-400',
  'bg-orange-100 text-orange-500 dark:bg-orange-950 dark:text-orange-400',
  'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  'bg-sky-100 text-sky-500 dark:bg-sky-950 dark:text-sky-400',
];

/** A small stable number from some text, so the same recipe always gets the same picture and colour. */
export function seedOf(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return hash;
}

/** A coloured tile with a drawing of some food, chosen from the text (usually the recipe title). */
export function FoodArt({ seed = '', className }: { seed?: string; className?: string }) {
  const hash = seedOf(seed);
  const art = ARTS[hash % ARTS.length];
  const tile = TILES[Math.floor(hash / ARTS.length) % TILES.length];
  return (
    <div data-slot="card-image" className={cn('flex items-center justify-center overflow-hidden', tile, className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        className="size-1/2 min-w-14 transition-transform duration-300 ease-out group-hover/card:rotate-6 group-hover/card:scale-110"
      >
        {art}
      </svg>
    </div>
  );
}
