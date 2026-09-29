'use client';

import {
  Apple,
  Banana,
  Bean,
  Beef,
  Carrot,
  Cherry,
  Citrus,
  Cookie,
  Croissant,
  Drumstick,
  Egg,
  Fish,
  Flame,
  Grape,
  Ham,
  IceCream,
  Leaf,
  LeafyGreen,
  Milk,
  Nut,
  Salad,
  Soup,
  Sprout,
  Utensils,
  Wheat,
  Wine,
  type LucideIcon,
} from 'lucide-react';

/**
 * A food icon and a colour for an ingredient, worked out from its name.
 *
 * Restaurants type ingredients freely - "Paneer", "fresh coriander", "Chicken
 * breast" - so there is nothing to look a picture up by except the words. This
 * matches on keywords, longest first, and falls back to a neutral fork-and-knife
 * rather than guessing wrong.
 *
 * The point is speed of reading, not decoration: a diner scanning a list of
 * fifteen ingredients spots the red meat icon or the milk icon long before they
 * finish reading the names. Colours are soft tints so a long list stays calm.
 */

interface IconStyle {
  icon: LucideIcon;
  /** Chip background + icon colour, kept soft so a dozen of them do not shout. */
  className: string;
}

const NEUTRAL: IconStyle = { icon: Utensils, className: 'bg-stone-100 text-stone-600' };

const GREEN = 'bg-emerald-50 text-emerald-700';
const LEAF = 'bg-lime-50 text-lime-700';
const RED = 'bg-rose-50 text-rose-700';
const ORANGE = 'bg-orange-50 text-orange-700';
const AMBER = 'bg-amber-50 text-amber-700';
const BLUE = 'bg-sky-50 text-sky-700';
const PURPLE = 'bg-violet-50 text-violet-700';
const PINK = 'bg-pink-50 text-pink-700';

/**
 * Keyword to icon. Order matters: the first match wins, so more specific words
 * ("coconut milk") must come before looser ones ("milk").
 */
const RULES: Array<[string[], IconStyle]> = [
  // Dairy
  [['paneer', 'cheese', 'mozzarella', 'cheddar', 'feta'], { icon: Milk, className: AMBER }],
  [['coconut milk', 'almond milk', 'soy milk'], { icon: Milk, className: GREEN }],
  [['milk', 'cream', 'curd', 'yoghurt', 'yogurt', 'dahi', 'butter', 'ghee', 'khoya'], { icon: Milk, className: BLUE }],
  [['ice cream', 'kulfi'], { icon: IceCream, className: PINK }],

  // Meat, fish, egg
  [['chicken', 'murgh'], { icon: Drumstick, className: ORANGE }],
  [['mutton', 'lamb', 'beef', 'pork', 'keema', 'meat'], { icon: Beef, className: RED }],
  [['bacon', 'sausage', 'salami', 'ham'], { icon: Ham, className: RED }],
  [['fish', 'prawn', 'shrimp', 'crab', 'squid', 'seafood'], { icon: Fish, className: BLUE }],
  [['egg', 'anda'], { icon: Egg, className: AMBER }],

  // Greens and vegetables
  [['lettuce', 'spinach', 'palak', 'kale', 'cabbage', 'greens', 'methi', 'arugula'], { icon: LeafyGreen, className: LEAF }],
  [['coriander', 'cilantro', 'mint', 'pudina', 'basil', 'curry leaf', 'parsley', 'herb', 'tulsi'], { icon: Leaf, className: LEAF }],
  [['carrot', 'gajar'], { icon: Carrot, className: ORANGE }],
  [['salad', 'cucumber', 'celery', 'broccoli', 'capsicum', 'pepper', 'zucchini', 'beans', 'peas', 'okra', 'bhindi', 'gourd', 'brinjal', 'eggplant', 'cauliflower', 'mushroom', 'corn', 'sweetcorn'], { icon: Salad, className: GREEN }],
  [['sprout', 'microgreen'], { icon: Sprout, className: LEAF }],
  [['onion', 'garlic', 'ginger', 'potato', 'aloo', 'beetroot', 'radish', 'turnip', 'yam'], { icon: Sprout, className: AMBER }],

  // Fruit
  [['tomato', 'apple', 'guava'], { icon: Apple, className: RED }],
  [['lemon', 'lime', 'orange', 'nimbu', 'citrus'], { icon: Citrus, className: AMBER }],
  [['grape', 'raisin', 'kishmish'], { icon: Grape, className: PURPLE }],
  [['banana', 'plantain'], { icon: Banana, className: AMBER }],
  [['cherry', 'berry', 'strawberry', 'jamun'], { icon: Cherry, className: PINK }],
  [['mango', 'pineapple', 'papaya', 'melon', 'fruit'], { icon: Apple, className: ORANGE }],

  // Grains, pulses, nuts
  [['flour', 'atta', 'maida', 'wheat', 'bread', 'bun', 'pav', 'rice', 'basmati', 'poha', 'semolina', 'suji', 'oats', 'noodle', 'pasta'], { icon: Wheat, className: AMBER }],
  [['naan', 'roti', 'paratha', 'croissant', 'pastry', 'puff'], { icon: Croissant, className: AMBER }],
  [['dal', 'lentil', 'chana', 'rajma', 'chickpea', 'bean', 'soy', 'tofu', 'moong', 'urad'], { icon: Bean, className: GREEN }],
  [['cashew', 'almond', 'peanut', 'pista', 'pistachio', 'walnut', 'nut', 'badam'], { icon: Nut, className: ORANGE }],

  // Spice, oil, sweet, drinks
  [['chilli', 'chili', 'mirch', 'masala', 'spice', 'pepper corn', 'garam', 'paprika', 'cayenne'], { icon: Flame, className: RED }],
  [['oil', 'vinegar', 'sauce', 'stock', 'broth', 'gravy', 'water'], { icon: Soup, className: BLUE }],
  [['sugar', 'jaggery', 'gur', 'honey', 'chocolate', 'cocoa', 'syrup'], { icon: Cookie, className: ORANGE }],
  [['wine', 'beer', 'rum', 'whisky', 'vodka', 'alcohol'], { icon: Wine, className: PURPLE }],
  [['salt', 'namak'], { icon: Utensils, className: 'bg-stone-100 text-stone-600' }],
];

export function ingredientIcon(name: string): IconStyle {
  const term = name.trim().toLowerCase();

  for (const [keywords, style] of RULES) {
    if (keywords.some((keyword) => term.includes(keyword))) return style;
  }

  return NEUTRAL;
}

/**
 * One ingredient, as a chip.
 *
 * An allergen turns the chip amber and adds the note, so "contains milk" is read
 * at the ingredient rather than only in the summary line at the top.
 */
export function IngredientChip({
  name,
  allergenInfo,
}: {
  name: string;
  allergenInfo: string | null;
}) {
  const { icon: Icon, className } = ingredientIcon(name);

  return (
    <li className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2">
      <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${className}`}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink">{name}</span>
        {allergenInfo && (
          <span className="block truncate text-xs font-medium text-warn-600">{allergenInfo}</span>
        )}
      </span>
    </li>
  );
}
