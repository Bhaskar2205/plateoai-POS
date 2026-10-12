import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Plateo's own administration.
 *
 * Its own title, because this is served on its own host: a tab reading "Plateo
 * Restaurant Admin" on admin.plateoai.in would say the panel belongs to a
 * restaurant, which is precisely what it does not.
 *
 * Kept out of search engines. Nothing here is useful to anyone who is not an
 * administrator, and an indexed sign-in page for the account that can open and
 * suspend every restaurant on the platform is an invitation.
 *
 * The pages themselves are client components and cannot export metadata, so it
 * lives here.
 */
export const metadata: Metadata = {
  title: 'Plateo administration',
  description: 'Restaurant accounts on the Plateo platform.',
  robots: { index: false, follow: false },
};

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return children;
}
