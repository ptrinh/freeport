/**
 * Marketplace categories.
 *
 * Rideshare is its own implicit category (every rideshare intent belongs to it)
 * and is NOT offered in the Service/Product post form's category dropdown.
 * The Browse filter, however, can filter by it when the Service/Product
 * vertical is enabled.
 */
export const RIDESHARE_CATEGORY = 'Ridesharing';

/** Vehicle subcategories shown in the Ridesharing post form. */
export const RIDESHARE_SUBCATEGORIES = ['Compact Car', 'Motorbike', 'Large Car', 'Luxury Car', 'Others'];
export const DEFAULT_RIDESHARE_SUBCATEGORY = 'Compact Car';

/**
 * Seating capacity per vehicle subcategory, shown beside the (unchanged)
 * category name in the ride request form. 'Others' and 'Luxury Car' are
 * intentionally absent — capacity varies, so no seater suffix is rendered.
 */
export const VEHICLE_SEATERS: Record<string, number> = {
  'Compact Car': 4,
  'Large Car': 6,
  'Motorbike': 1,
};

/** MaterialCommunityIcons glyph per vehicle subcategory (vector, monochrome). */
export const VEHICLE_ICONS: Record<string, string> = {
  'Compact Car': 'car-hatchback',
  'Motorbike': 'motorbike',
  'Large Car': 'car-estate',
  'Luxury Car': 'car-sports',
  'Others': 'dots-horizontal',
};

/**
 * MaterialCommunityIcons glyph per top-level category (vector, monochrome).
 * Follows the VEHICLE_ICONS pattern. Use CATEGORY_ICON_FALLBACK for anything unmapped.
 */
export const CATEGORY_ICON_FALLBACK = 'tag-outline';
export const CATEGORY_ICONS: Record<string, string> = {
  'Ridesharing': 'car',
  'Home Services': 'home-city',
  'Food & Catering': 'silverware-fork-knife',
  'Tutoring & Lessons': 'school',
  'Beauty & Wellness': 'spa',
  'Entertainment': 'party-popper',
  'Repair & Maintenance': 'wrench',
  'Moving & Delivery': 'truck-delivery',
  'Errands & Tasks': 'clipboard-check',
  'Property': 'home-city-outline',
  'Electronics': 'devices',
  'Fashion & Apparel': 'tshirt-crew',
  'Handmade & Goods': 'hand-heart',
  'Digital Goods': 'download-box-outline',
  'Crypto': 'bitcoin',
  'Other': 'dots-horizontal',
};

/**
 * MaterialCommunityIcons glyph per subcategory (vector, monochrome).
 * Keys are subcategory names across all categories. Use SUBCATEGORY_ICON_FALLBACK
 * for anything unmapped (incl. every category's "Other").
 */
export const SUBCATEGORY_ICON_FALLBACK = 'dots-horizontal';
export const SUBCATEGORY_ICONS: Record<string, string> = {
  // Home Services
  'Cleaning': 'broom',
  'Plumbing': 'pipe-wrench',
  'Electrical': 'flash',
  'Aircon': 'air-conditioner',
  'Pest Control': 'bug',
  'Gardening': 'flower',
  // Food & Catering
  'Home Cooking': 'pot-steam',
  'Baking & Desserts': 'cupcake',
  'Catering': 'silverware-variant',
  'Drinks': 'cup',
  // Tutoring & Lessons
  'Academic': 'book-open-variant',
  'Languages': 'translate',
  'Music': 'music',
  'Coding': 'code-tags',
  'Sports': 'basketball',
  // Beauty & Wellness
  'Hair': 'content-cut',
  'Nails': 'hand-back-right',
  'Makeup': 'lipstick',
  'Massage': 'spa-outline',
  'Fitness': 'dumbbell',
  // Entertainment
  'Events & Tickets': 'ticket',
  'Live Music': 'guitar-electric',
  'DJ & MC': 'microphone-variant',
  'Photo & Video': 'camera',
  'Party Rental': 'balloon',
  'Games & Hobbies': 'gamepad-variant',
  'Adults': 'glass-cocktail',
  // Repair & Maintenance
  'Phone & Computer': 'cellphone-cog',
  'Appliances': 'washing-machine',
  'Furniture': 'sofa',
  'Vehicle': 'car-wrench',
  'Handyman': 'hammer-screwdriver',
  // Moving & Delivery
  'Courier': 'package-variant-closed',
  'House Moving': 'truck',
  'Furniture Delivery': 'dolly',
  'Food Delivery': 'moped',
  // Errands & Tasks
  'Shopping': 'cart',
  'Queueing': 'human-queue',
  'Pet Care': 'paw',
  'Admin': 'file-document-outline',
  // Property
  'Apartment for Rent': 'office-building',
  'House for Rent': 'home',
  'Room / Shared': 'bed',
  'Property for Sale': 'home-city',
  'Land': 'island',
  'Commercial': 'store',
  // Electronics
  'Phones': 'cellphone',
  'Computers': 'laptop',
  'Audio': 'headphones',
  'TV & Home': 'television',
  'Gaming': 'controller-classic',
  'Cameras': 'camera',
  'Accessories': 'cable-data',
  // Fashion & Apparel
  'Men': 'tshirt-crew',
  'Women': 'human-female',
  'Kids': 'baby-face-outline',
  'Shoes': 'shoe-sneaker',
  'Bags': 'bag-personal',
  'Jewelry': 'diamond-stone',
  // Handmade & Goods
  'Crafts': 'palette-swatch',
  'Art': 'palette',
  'Secondhand': 'recycle',
  // Digital Goods
  'Licence': 'license',
  'E-books': 'book-open-page-variant',
  'Media': 'play-box-multiple',
  'Software': 'application-brackets-outline',
  'Game Items': 'sword',
  'Templates': 'file-document-multiple-outline',
  // Crypto
  'Buy / Sell': 'swap-horizontal',
  'Stablecoin': 'currency-usd',
  'Exchange / OTC': 'bank-transfer',
  'Mining': 'pickaxe',
  'Wallets & Hardware': 'wallet',
  'Consulting': 'account-tie',
};

/** Icon glyph for a category, with fallback. */
export function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? CATEGORY_ICON_FALLBACK;
}

/** Icon glyph for a subcategory, with fallback (vehicle subcategories defer to VEHICLE_ICONS). */
export function subcategoryIcon(subcategory: string): string {
  return SUBCATEGORY_ICONS[subcategory] ?? VEHICLE_ICONS[subcategory] ?? SUBCATEGORY_ICON_FALLBACK;
}

/** Subcategories per service/product category (each ends with "Other" as a catch-all). */
// Sorted A–Z by category name (the catch-all "Other" is kept last). Ridesharing
// is a separate implicit category prepended ahead of these in the UI.
export const SERVICE_SUBCATEGORIES: Record<string, string[]> = {
  'Beauty & Wellness': ['Hair', 'Nails', 'Makeup', 'Massage', 'Fitness', 'Other'],
  'Crypto': ['Buy / Sell', 'Stablecoin', 'Exchange / OTC', 'Mining', 'Wallets & Hardware', 'Consulting', 'Other'],
  'Digital Goods': ['Licence', 'E-books', 'Media', 'Software', 'Game Items', 'Templates', 'Other'],
  'Electronics': ['Phones', 'Computers', 'Audio', 'TV & Home', 'Gaming', 'Cameras', 'Accessories', 'Other'],
  'Entertainment': ['Events & Tickets', 'Live Music', 'DJ & MC', 'Photo & Video', 'Party Rental', 'Games & Hobbies', 'Adults', 'Other'],
  'Errands & Tasks': ['Shopping', 'Queueing', 'Pet Care', 'Admin', 'Other'],
  'Fashion & Apparel': ['Men', 'Women', 'Kids', 'Shoes', 'Bags', 'Jewelry', 'Accessories', 'Other'],
  'Food & Catering': ['Home Cooking', 'Baking & Desserts', 'Catering', 'Drinks', 'Other'],
  'Handmade & Goods': ['Crafts', 'Art', 'Secondhand', 'Other'],
  'Home Services': ['Cleaning', 'Plumbing', 'Electrical', 'Aircon', 'Pest Control', 'Gardening', 'Other'],
  'Moving & Delivery': ['Courier', 'House Moving', 'Furniture Delivery', 'Food Delivery', 'Other'],
  'Property': ['Apartment for Rent', 'House for Rent', 'Room / Shared', 'Property for Sale', 'Land', 'Commercial', 'Other'],
  'Repair & Maintenance': ['Phone & Computer', 'Appliances', 'Furniture', 'Vehicle', 'Handyman', 'Other'],
  'Tutoring & Lessons': ['Academic', 'Languages', 'Music', 'Coding', 'Sports', 'Other'],
  'Other': [],
};

/** Categories shown in the Service/Product post form. */
export const SERVICE_CATEGORIES = Object.keys(SERVICE_SUBCATEGORIES);

/** The category an intent belongs to (rideshare → Ridesharing; service → payload.category). */
export function categoryOf(schema: string, payload: Record<string, unknown>): string {
  if (schema.startsWith('rideshare')) return RIDESHARE_CATEGORY;
  return (payload?.category as string) || 'Other';
}

/** Map of categories → their subcategories (Ridesharing + every service category). */
export const SUBCATEGORIES: Record<string, string[]> = {
  [RIDESHARE_CATEGORY]: RIDESHARE_SUBCATEGORIES,
  ...SERVICE_SUBCATEGORIES,
};

export function subcategoriesFor(category: string): string[] {
  return SUBCATEGORIES[category] ?? [];
}

/** The subcategory an intent belongs to. */
export function subcategoryOf(schema: string, payload: Record<string, unknown>): string | undefined {
  // Rideshare keeps the vehicle in payload.category; service keeps it in payload.subcategory.
  return schema.startsWith('rideshare') ? (payload?.category as string) : (payload?.subcategory as string);
}
