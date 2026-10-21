'use client';

import { Check, CircleAlert, Info, Lock, Percent, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { formatMoney } from '@/lib/format';
import { canManageTables } from '@/lib/permissions';
import {
  useApplyTaxProfile,
  useCreateTaxComponent,
  useDeleteTaxComponent,
  useTaxProfile,
  useUpdateTaxComponent,
} from '@/lib/queries';
import type { TaxComponent, TaxGroup, TaxKind } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { TaxedItemsCard } from '@/components/taxes/taxed-items-card';

/**
 * What the restaurant adds on top of its menu prices.
 *
 * Built around the fact that an Indian bill is not "menu price plus tax": GST is
 * filed as CGST and SGST on separate lines, alcohol sits outside GST entirely,
 * and a service charge is the restaurant's own charge rather than a tax. Each is
 * a row here so the bill can print what it actually charged.
 *
 * Rates are the restaurant's responsibility, so nothing is applied on their
 * behalf. The suggested profiles are starting points they confirm.
 */

const KINDS: Array<{ value: TaxKind; label: string; hint: string }> = [
  { value: 'CGST', label: 'CGST', hint: 'Central GST. Half of a within-state rate.' },
  { value: 'SGST', label: 'SGST', hint: 'State GST. The other half.' },
  { value: 'IGST', label: 'IGST', hint: 'One line instead of CGST+SGST, across a state line.' },
  { value: 'UTGST', label: 'UTGST', hint: 'For a union territory.' },
  { value: 'CESS', label: 'Cess', hint: 'Compensation cess, e.g. on aerated drinks.' },
  { value: 'VAT', label: 'VAT', hint: 'State VAT. Alcohol is outside GST and still pays this.' },
  {
    value: 'SERVICE_CHARGE',
    label: 'Service charge',
    hint: 'Your own charge, not a tax. Taxed along with the food.',
  },
  { value: 'OTHER', label: 'Other', hint: 'Anything else you print on a bill.' },
];

const GROUPS: Array<{ value: TaxGroup; label: string; hint: string }> = [
  { value: 'STANDARD', label: 'Food & drink', hint: 'Everything you cook and serve.' },
  { value: 'ALCOHOL', label: 'Alcohol', hint: 'Outside GST; state VAT applies instead.' },
  { value: 'PACKAGED', label: 'Packaged items', hint: 'Sold sealed, as bought.' },
  { value: 'EXEMPT', label: 'Exempt', hint: 'Carries no tax at all.' },
];

const labelForKind = (kind: TaxKind) => KINDS.find((k) => k.value === kind)?.label ?? kind;
const labelForGroup = (group: TaxGroup) => GROUPS.find((g) => g.value === group)?.label ?? group;

export default function TaxesPage() {
  const { session } = useAuth();
  const toast = useToast();
  const canManage = canManageTables(session?.user.role);
  const { data, isPending, isError, error, refetch } = useTaxProfile(canManage);
  const [adding, setAdding] = useState(false);

  const create = useCreateTaxComponent({
    onSuccess: () => {
      setAdding(false);
      toast.success('Charge added. It applies to bills that are still open.');
    },
    onError: (e) => toast.error(e),
  });
  const update = useUpdateTaxComponent({ onError: (e) => toast.error(e) });
  const remove = useDeleteTaxComponent({
    onSuccess: () => toast.success('Charge removed.'),
    onError: (e) => toast.error(e),
  });
  const applyProfile = useApplyTaxProfile({
    onSuccess: () => toast.success('Profile applied. Check the rates before you bill.'),
    onError: (e) => toast.error(e),
  });

  if (!session) return null;

  if (!canManage) {
    return (
      <>
        <PageHeader title="Taxes & Charges" description="What gets added to every bill." />
        <EmptyState
          icon={Lock}
          title="Only the owner can change tax rates"
          description="These are the figures the restaurant files, so they are kept to the owner's account. Ask them to set this up."
        />
      </>
    );
  }

  const components = data?.components ?? [];
  const taxes = components.filter((c) => c.kind !== 'SERVICE_CHARGE');
  const serviceCharges = components.filter((c) => c.kind === 'SERVICE_CHARGE');

  return (
    <>
      <PageHeader
        title="Taxes & Charges"
        description="What Plateo adds on top of your menu prices, and what prints on the bill."
        action={
          <Button onClick={() => setAdding(true)} disabled={isPending}>
            <Plus className="size-4" aria-hidden />
            Add a charge
          </Button>
        }
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="space-y-5">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <p className="text-sm text-muted">Currently charged on food & drink</p>
                <p className="mt-1 text-3xl font-bold text-ink tabular-nums">
                  {data.standardRate}%
                </p>
                <p className="mt-1 text-xs text-muted">
                  {components.length === 0
                    ? 'Nothing configured, so bills are your menu prices exactly.'
                    : `${components.length} charge${components.length === 1 ? '' : 's'} on the bill`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted">GSTIN on the bill</p>
                <p className="mt-1 font-mono text-sm font-semibold text-ink">
                  {data.taxNumber ?? 'Not set'}
                </p>
                {!data.taxNumber && (
                  <p className="mt-1 text-xs text-muted">Add it on Restaurant Profile.</p>
                )}
              </div>
            </div>
          </Card>

          {/* A worked example beats a rate: it is how a restaurant checks the
              setup is what they meant before a guest sees it. */}
          <Card>
            <CardHeader
              title="What a ₹1,000 bill would look like"
              description="Exactly how Plateo will work it out, in the order it applies."
            />
            <ExampleBill components={components} />
          </Card>

          {components.length === 0 ? (
            <EmptyState
              icon={Percent}
              title="No charges set up yet"
              description="Pick a starting point below, or add charges one at a time. Until then bills are your menu prices with nothing added."
            />
          ) : (
            <>
              <ChargeList
                title="Taxes"
                description="Each prints on its own line, which is what a GST invoice requires."
                rows={taxes}
                onToggle={(id, isActive) => update.mutate({ id, isActive })}
                onRate={(id, rate) => update.mutate({ id, rate })}
                onRemove={(id) => remove.mutate(id)}
                busy={remove.isPending || update.isPending}
              />
              {serviceCharges.length > 0 && (
                <ChargeList
                  title="Service charge"
                  description="Your own charge, not a tax - and GST applies on top of it. A guest may decline it, so keep it easy to remove from a bill."
                  rows={serviceCharges}
                  onToggle={(id, isActive) => update.mutate({ id, isActive })}
                  onRate={(id, rate) => update.mutate({ id, rate })}
                  onRemove={(id) => remove.mutate(id)}
                  busy={remove.isPending || update.isPending}
                />
              )}
            </>
          )}

          <Card>
            <CardHeader
              title="Start from a common setup"
              description="Replaces everything above. These are starting points to check against your own registration, not advice."
            />
            <div className="grid gap-3 p-5 pt-0 sm:grid-cols-2">
              {data.suggested.map((profile) => (
                <div
                  key={profile.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-line p-4"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-ink">{profile.label}</p>
                      <Badge>{profile.totalRate}%</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted">{profile.description}</p>
                  </div>
                  <Button
                    variant="secondary"
                    loading={applyProfile.isPending && applyProfile.variables === profile.id}
                    onClick={() => applyProfile.mutate(profile.id)}
                  >
                    Use this
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <TaxedItemsCard components={components} />

          <p className="flex items-start gap-2 rounded-xl bg-info-50 px-4 py-3 text-xs text-info-700">
            <Info className="mt-px size-4 shrink-0" aria-hidden />
            <span>
              Changing a rate applies to bills that are still open. Bills already settled keep the
              breakdown they were charged, so your past takings never move. Plateo does not give tax
              advice: the rate you owe depends on your registration and premises.
            </span>
          </p>
        </div>
      )}

      {adding && (
        <AddChargeDialog
          submitting={create.isPending}
          onClose={() => setAdding(false)}
          onSubmit={(body) => create.mutate(body)}
        />
      )}
    </>
  );
}

/** A worked example, computed the same way the API does. */
function ExampleBill({ components }: { components: TaxComponent[] }) {
  const base = 1000;
  const active = components.filter((c) => c.isActive && c.appliesTo === 'STANDARD');
  const service = active
    .filter((c) => c.kind === 'SERVICE_CHARGE')
    .reduce((sum, c) => sum + Math.round(base * c.rate) / 100, 0);
  const taxBase = base + service;
  const taxLines = active
    .filter((c) => c.kind !== 'SERVICE_CHARGE')
    .map((c) => ({ id: c.id, name: c.name, rate: c.rate, amount: Math.round(taxBase * c.rate) / 100 }));
  const taxTotal = taxLines.reduce((sum, line) => sum + line.amount, 0);

  return (
    <dl className="space-y-1.5 p-5 pt-0 text-sm">
      <Line label="Food & drink" value={formatMoney(base)} />
      {service > 0 && <Line label="Service charge" value={formatMoney(service)} />}
      {taxLines.map((line) => (
        <Line key={line.id} label={`${line.name} @ ${line.rate}%`} value={formatMoney(line.amount)} />
      ))}
      <div className="flex items-baseline justify-between border-t border-line pt-2">
        <dt className="font-semibold text-ink">Guest pays</dt>
        <dd className="text-lg font-bold text-ink tabular-nums">
          {formatMoney(base + service + taxTotal)}
        </dd>
      </div>
    </dl>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function ChargeList({
  title,
  description,
  rows,
  onToggle,
  onRate,
  onRemove,
  busy,
}: {
  title: string;
  description: string;
  rows: TaxComponent[];
  onToggle: (id: number, isActive: boolean) => void;
  onRate: (id: number, rate: number) => void;
  onRemove: (id: number) => void;
  busy: boolean;
}) {
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <ul className="divide-y divide-line border-t border-line">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-ink">{row.name}</p>
                <Badge>{labelForKind(row.kind)}</Badge>
                {!row.isActive && <Badge tone="neutral">Off</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-muted">Applies to {labelForGroup(row.appliesTo)}</p>
            </div>

            <label className="flex items-center gap-1.5">
              <span className="sr-only">Rate for {row.name}</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                defaultValue={row.rate}
                onBlur={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next !== row.rate) onRate(row.id, next);
                }}
                className="h-10 w-20 rounded-lg border border-line bg-surface px-2 text-right text-sm font-semibold text-ink tabular-nums focus:border-brand-500 focus:outline-none"
              />
              <span className="text-sm text-muted">%</span>
            </label>

            <Button
              variant="ghost"
              onClick={() => onToggle(row.id, !row.isActive)}
              disabled={busy}
              aria-label={row.isActive ? `Stop charging ${row.name}` : `Charge ${row.name} again`}
            >
              {row.isActive ? 'Turn off' : 'Turn on'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => onRemove(row.id)}
              disabled={busy}
              aria-label={`Remove ${row.name}`}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AddChargeDialog({
  submitting,
  onClose,
  onSubmit,
}: {
  submitting: boolean;
  onClose: () => void;
  onSubmit: (body: Partial<TaxComponent>) => void;
}) {
  const [kind, setKind] = useState<TaxKind>('CGST');
  const [name, setName] = useState('CGST');
  const [rate, setRate] = useState('2.5');
  const [appliesTo, setAppliesTo] = useState<TaxGroup>('STANDARD');

  const numericRate = Number(rate);
  const valid = name.trim().length > 0 && Number.isFinite(numericRate) && numericRate >= 0 && numericRate <= 100;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-charge-title"
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface shadow-raised"
      >
        <div className="border-b border-line px-5 py-4">
          <h2 id="add-charge-title" className="text-base font-semibold text-ink">
            Add a charge
          </h2>
          <p className="text-sm text-muted">It applies to every bill from now on.</p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="text-sm font-medium text-ink">What is it?</span>
            <select
              value={kind}
              onChange={(event) => {
                const next = event.target.value as TaxKind;
                setKind(next);
                // The name is what prints, and it almost always matches the kind.
                setName(labelForKind(next));
              }}
              className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-brand-500 focus:outline-none"
            >
              {KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">
              {KINDS.find((k) => k.value === kind)?.hint}
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-ink">Prints on the bill as</span>
              <input
                value={name}
                maxLength={40}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Rate %</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-right text-sm font-semibold text-ink tabular-nums focus:border-brand-500 focus:outline-none"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-ink">Applies to</span>
            <select
              value={appliesTo}
              onChange={(event) => setAppliesTo(event.target.value as TaxGroup)}
              className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-brand-500 focus:outline-none"
            >
              {GROUPS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">
              {GROUPS.find((g) => g.value === appliesTo)?.hint} Set a dish&rsquo;s group on the Menu
              page.
            </span>
          </label>

          {!valid && (
            <p className="flex items-start gap-2 text-xs text-danger-600">
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
              Give it a name and a rate between 0 and 100.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            disabled={!valid}
            onClick={() => onSubmit({ name: name.trim(), kind, rate: numericRate, appliesTo })}
          >
            <Check className="size-4" aria-hidden />
            Add charge
          </Button>
        </div>
      </div>
    </div>
  );
}
