import { redirect } from 'next/navigation';

/**
 * The kitchen moved out of the restaurant admin into its own app, signed in with
 * a kitchen code on the kitchen's own screen.
 *
 * This route stays so older links and bookmarks still land somewhere useful, and
 * sends them to the kitchen app. The code itself is in the admin under Settings.
 */
export default function AdminKitchenPage() {
  redirect('/kitchen');
}
