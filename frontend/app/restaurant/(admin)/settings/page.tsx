'use client';

import { CheckCircle2, Copy, ExternalLink, KeyRound, LogOut, UserRound, UtensilsCrossed } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { canManageTables } from '@/lib/permissions';
import { KitchenCodeCard } from '@/components/dashboard/kitchen-code-card';
import { ROLE_LABELS } from '@/components/dashboard/sidebar';
import { PageHeader } from '@/components/page-header';

/**
 * Account and session settings. Everything shown comes from the verified
 * session (`/auth/me`); nothing sensitive (tokens, hashes) is ever displayed.
 */
export default function SettingsPage() {
  const { session, signOut } = useAuth();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  if (!session) return null;

  // Shared and printed, so it must be the permanent slug.
  const menuPath = `/menu/${session.restaurant.publicSlug}`;
  const menuUrl = typeof window === 'undefined' ? menuPath : `${window.location.origin}${menuPath}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(menuUrl);
      setCopied(true);
      toast.success('Public menu link copied.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(new Error('Could not copy the link. Select it and copy it manually.'));
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="Your account, your public menu link and this browser session." />

      <div className="space-y-6">
        {/* Only owners may read the kitchen code, so only they are shown the card. */}
        {canManageTables(session.user.role) && <KitchenCodeCard />}

        <Card>
          <CardHeader title="Account" description="The person signed in to this dashboard." />
          <CardBody>
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
              <Detail icon={<UserRound className="size-4" aria-hidden />} label="Name" value={session.user.name} />
              <Detail label="Email" value={session.user.email} />
              <Detail label="Role" value={ROLE_LABELS[session.user.role]} />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Public menu link"
            description="Share this link or print it. It never changes, even if you rename your restaurant."
          />
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-line bg-ground px-3 py-2">
              <UtensilsCrossed className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="truncate font-mono text-sm text-ink" title={menuUrl}>
                {menuUrl}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void copy()}>
                {copied ? <CheckCircle2 className="size-4 text-brand-600" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Link
                href={menuPath as Route}
                target="_blank"
                rel="noopener"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-offset-0"
              >
                <ExternalLink className="size-4" aria-hidden />
                Open
              </Link>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Session and security" />
          <CardBody className="space-y-4">
            <div className="flex gap-3">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <p className="text-sm text-muted">
                You stay signed in on this browser until you sign out or your session expires. Sign out when using a
                shared or public device. Password changes aren’t available in the dashboard yet.
              </p>
            </div>
            <div className="flex justify-end border-t border-line pt-4">
              <Button variant="danger" onClick={() => void signOut()}>
                <LogOut className="size-4" aria-hidden />
                Sign out of this browser
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Detail({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}
