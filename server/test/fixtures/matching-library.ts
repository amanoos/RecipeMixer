/** A small, hand-written library of generic recipes used to check matching quality. */
export interface FixtureRecipe {
  title: string;
  rating?: number;
  ingredients: string[];
}

export const LIBRARY: FixtureRecipe[] = [
  {
    title: 'Chicken fried rice',
    ingredients: [
      '2 cups cooked rice',
      '2 chicken breasts, diced',
      '3 eggs',
      '1 cup frozen peas and carrots',
      '3 tbsp soy sauce',
      '2 green onions, sliced',
      '2 cloves garlic, minced',
      '2 tbsp vegetable oil',
      'salt and pepper to taste',
    ],
  },
  {
    title: 'Spinach curry',
    ingredients: [
      '1 lb fresh spinach',
      '1 yellow onion, chopped',
      '3 cloves garlic',
      '1 inch fresh ginger',
      '1 can (14 oz) diced tomatoes',
      '1 tsp ground cumin',
      '1 tsp turmeric',
      '1 cup coconut milk',
      '2 tbsp olive oil',
      'salt',
    ],
  },
  {
    title: 'Tomato soup',
    ingredients: [
      '2 lbs ripe tomatoes',
      '1 onion, chopped',
      '2 cloves garlic',
      '2 cups vegetable broth',
      '1/2 cup heavy cream',
      '2 tbsp butter',
      'fresh basil',
      'salt and pepper',
    ],
  },
  {
    title: 'Pasta carbonara',
    ingredients: [
      '8 oz spaghetti',
      '4 egg yolks',
      '1 cup grated parmesan cheese',
      '4 slices bacon',
      'freshly ground black pepper',
      'salt',
    ],
  },
  {
    title: 'Peanut noodles',
    ingredients: [
      '8 oz spaghetti',
      '1/4 cup peanut butter',
      '3 tbsp soy sauce',
      '1 tbsp rice vinegar',
      '2 cloves garlic',
      '1 tsp sesame oil',
      '2 green onions',
    ],
  },
  {
    title: 'Pancakes',
    rating: 4,
    ingredients: [
      '1 1/2 cups all-purpose flour',
      '3 1/2 tsp baking powder',
      '1 tbsp sugar',
      '1 1/4 cups milk',
      '1 egg',
      '3 tbsp butter, melted',
      '1/4 tsp salt',
    ],
  },
  {
    title: 'Garlic butter chicken',
    ingredients: [
      '4 chicken thighs',
      '4 tbsp butter',
      '5 cloves garlic',
      '1 tbsp fresh thyme',
      '1 lemon, juiced',
      'salt and pepper',
    ],
  },
  {
    title: 'Vegetable stir fry',
    ingredients: [
      '1 red bell pepper',
      '1 head broccoli',
      '2 carrots',
      '1 cup snap peas',
      '3 tbsp soy sauce',
      '1 tbsp fresh ginger',
      '2 cloves garlic',
      '2 tbsp vegetable oil',
      'cooked rice',
    ],
  },
  {
    title: 'Beef tacos',
    ingredients: [
      '1 lb ground beef',
      '1 packet taco seasoning',
      '8 corn tortillas',
      '1 cup shredded cheddar cheese',
      '1 tomato, diced',
      '1/2 head lettuce, shredded',
      '1/2 cup sour cream',
    ],
  },
  {
    title: 'Chocolate chip cookies',
    rating: 5,
    ingredients: [
      '2 1/4 cups all-purpose flour',
      '1 tsp baking soda',
      '1 cup butter, softened',
      '3/4 cup white sugar',
      '3/4 cup brown sugar',
      '2 eggs',
      '2 cups chocolate chips',
      '1 tsp vanilla extract',
    ],
  },
  {
    title: 'Greek salad',
    ingredients: [
      '4 tomatoes',
      '1 cucumber',
      '1 red onion',
      '1 cup kalamata olives',
      '8 oz feta cheese',
      '3 tbsp olive oil',
      '1 tbsp red wine vinegar',
      'dried oregano',
    ],
  },
  {
    title: 'Chili',
    ingredients: [
      '1 lb ground beef',
      '1 onion',
      '3 cloves garlic',
      '1 can kidney beans',
      '1 can black beans',
      '1 can diced tomatoes',
      '2 tbsp chili powder',
      '1 tsp cumin',
      'salt',
    ],
  },
  {
    title: 'Lentil soup',
    ingredients: [
      '1 cup red lentils',
      '1 onion',
      '2 carrots',
      '2 stalks celery',
      '3 cloves garlic',
      '6 cups chicken broth',
      '1 tsp cumin',
      '2 tbsp olive oil',
      'lemon juice',
    ],
  },
  {
    title: 'Margherita pizza',
    ingredients: [
      '1 pizza dough',
      '1/2 cup tomato sauce',
      '8 oz fresh mozzarella',
      'fresh basil leaves',
      '2 tbsp olive oil',
      'salt',
    ],
  },
  {
    title: 'Guacamole',
    ingredients: [
      '3 ripe avocados',
      '1 lime, juiced',
      '1/2 cup diced onion',
      '3 tablespoons chopped cilantro',
      '1 jalapeño, minced',
      '1 tomato',
      'salt',
    ],
  },
  {
    title: 'Omelette',
    ingredients: [
      '3 eggs',
      '2 tbsp milk',
      '1 tbsp butter',
      '1/4 cup shredded cheese',
      '1/4 cup diced ham',
      'salt and pepper',
    ],
  },
  {
    title: 'Mac and cheese',
    ingredients: [
      '8 oz elbow macaroni',
      '2 cups shredded cheddar cheese',
      '2 cups milk',
      '3 tbsp butter',
      '3 tbsp flour',
      'salt',
    ],
  },
  {
    title: 'Banana bread',
    ingredients: [
      '3 ripe bananas',
      '1/3 cup butter, melted',
      '3/4 cup sugar',
      '1 egg',
      '1 tsp vanilla extract',
      '1 tsp baking soda',
      '1 1/2 cups all-purpose flour',
      'pinch of salt',
    ],
  },
  {
    title: 'Tuna salad sandwich',
    ingredients: [
      '2 cans tuna, drained',
      '1/4 cup mayonnaise',
      '1 stalk celery',
      '1 tbsp lemon juice',
      '4 slices bread',
      'salt and pepper',
    ],
  },
  {
    title: 'Shrimp scampi',
    ingredients: [
      '1 lb shrimp',
      '8 oz linguine',
      '4 tbsp butter',
      '4 cloves garlic',
      '1/2 cup white wine',
      '1 lemon',
      'fresh parsley',
      'salt and pepper',
      'olive oil',
    ],
  },
  {
    title: 'Hummus',
    ingredients: [
      '1 can chickpeas',
      '1/4 cup tahini',
      '2 cloves garlic',
      '3 tbsp lemon juice',
      '2 tbsp olive oil',
      '1/2 tsp cumin',
      'salt',
    ],
  },
  {
    title: 'Potato soup',
    ingredients: [
      '4 potatoes, peeled and cubed',
      '1 onion',
      '3 cups chicken broth',
      '1 cup milk',
      '4 slices bacon',
      '1/2 cup shredded cheddar cheese',
      'salt and pepper',
    ],
  },
  {
    title: 'Roasted vegetables',
    ingredients: [
      '2 sweet potatoes',
      '1 red onion',
      '1 zucchini',
      '2 carrots',
      '3 tbsp olive oil',
      '1 tsp dried thyme',
      'salt and pepper',
    ],
  },
  {
    title: 'Fried eggs on toast',
    ingredients: ['2 eggs', '2 slices bread', '1 tbsp butter', 'salt and pepper'],
  },
  {
    title: 'Mushroom risotto',
    ingredients: [
      '1 1/2 cups arborio rice',
      '8 oz mushrooms',
      '1 onion',
      '4 cups vegetable broth',
      '1/2 cup white wine',
      '1/2 cup parmesan cheese',
      '2 tbsp butter',
    ],
  },
  {
    title: 'Lemon salmon',
    ingredients: ['4 salmon fillets', '2 lemons', '2 tbsp olive oil', '2 cloves garlic', 'fresh dill', 'salt and pepper'],
  },
  {
    title: 'Caprese salad',
    ingredients: [
      '4 tomatoes',
      '8 oz fresh mozzarella',
      'fresh basil',
      '2 tbsp olive oil',
      'balsamic vinegar',
      'salt',
    ],
  },
  {
    title: 'Oatmeal',
    ingredients: ['1 cup rolled oats', '2 cups milk', '1 tbsp honey', '1 banana', 'pinch of salt'],
  },
  {
    title: 'Peanut butter cookies',
    ingredients: ['1 cup peanut butter', '1 cup sugar', '1 egg', '1 tsp baking soda'],
  },
  {
    title: 'Butter chicken',
    ingredients: [
      '1 lb chicken breast',
      '1 cup yogurt',
      '2 tbsp garam masala',
      '1 onion',
      '3 cloves garlic',
      '1 can tomato sauce',
      '1 cup heavy cream',
      '2 tbsp butter',
      'cooked rice',
    ],
  },
];

export interface IngredientSet {
  name: string;
  have: string[];
  /** Must be the best match. */
  first?: string;
  /** Must appear in the top three. */
  topThree?: string[];
  /** Must not appear at all. */
  absent?: string[];
  /** Must appear somewhere. */
  present?: string[];
}

export const INGREDIENT_SETS: IngredientSet[] = [
  {
    name: 'fried rice ingredients',
    have: ['chicken', 'rice', 'soy sauce', 'egg', 'green onion'],
    first: 'Chicken fried rice',
  },
  {
    name: 'curry ingredients',
    have: ['spinach', 'onion', 'tomato', 'coconut milk', 'cumin'],
    topThree: ['Spinach curry'],
  },
  { name: 'eggs on toast', have: ['egg', 'bread', 'butter'], first: 'Fried eggs on toast' },
  {
    name: 'banana bread ingredients',
    have: ['banana', 'flour', 'sugar', 'egg', 'baking soda', 'butter', 'vanilla'],
    first: 'Banana bread',
  },
  { name: 'carbonara ingredients', have: ['spaghetti', 'egg', 'parmesan', 'bacon'], first: 'Pasta carbonara' },
  {
    name: 'peanut noodles ingredients',
    have: ['peanut butter', 'soy sauce', 'spaghetti', 'garlic', 'green onion'],
    first: 'Peanut noodles',
  },
  {
    name: 'plain butter is not peanut butter',
    have: ['butter'],
    absent: ['Peanut butter cookies', 'Peanut noodles'],
    present: ['Fried eggs on toast', 'Garlic butter chicken'],
  },
  { name: 'caprese ingredients', have: ['tomato', 'mozzarella', 'basil'], first: 'Caprese salad' },
  {
    name: 'green onion is not a plain onion',
    have: ['green onion'],
    present: ['Chicken fried rice', 'Peanut noodles'],
    absent: ['Greek salad', 'Chili', 'Tomato soup'],
  },
  {
    name: 'plain onion covers red and yellow onions but not green ones',
    have: ['onion'],
    present: ['Greek salad', 'Chili', 'Spinach curry'],
    absent: ['Chicken fried rice', 'Peanut noodles'],
  },
];
