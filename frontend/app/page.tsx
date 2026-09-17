import { redirect } from 'next/navigation';

/** Week 1 ships the restaurant admin only; the customer QR app lands here later. */
export default function HomePage() {
  redirect('/restaurant/dashboard');
}
