import { redirect } from 'next/navigation';

/**
 * Sections are managed on the menu screen itself, next to the dishes they group.
 *
 * This route stays so that old links and bookmarks keep working, but it sends
 * people to the one place sections are edited rather than offering a second,
 * competing screen for the same job.
 */
export default function CategoriesPage() {
  redirect('/restaurant/menu');
}
