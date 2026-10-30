'use client';

import { Check, ChefHat, Minus, Printer, Receipt, Scissors, Ruler } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { canManageTables } from '@/lib/permissions';
import { printableWidthMm, thermalPrinterConfig as config } from '@/lib/print-config';
import { printBill, printKotTicket } from '@/lib/print-receipt';
import { usePrintSettings } from '@/lib/queries';
import { PageHeader, SectionHeading } from '@/components/page-header';
import { BillLogoCard } from '@/components/printing/bill-logo-card';
import { PaymentQrCard } from '@/components/printing/payment-qr-card';
import { sampleBill, sampleKot } from '@/components/printing/sample-documents';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';

/**
 * How this restaurant's kitchen tickets and bills come out of the printer.
 *
 * Two different jobs on one screen because they share one roll: the kitchen
 * ticket a cook reads over a pass, and the bill a guest is handed. The only
 * thing here an owner actually sets is the payment QR - everything else is
 * decided by the paper and by what a kitchen ticket and a tax invoice have to
 * say, and is shown so they can check it rather than change it.
 */
export default function PrintingPage() {
  const { session } = useAuth();
  const toast = useToast();
  const owner = canManageTables(session?.user.role);
  const settings = usePrintSettings(owner);
  const [testing, setTesting] = useState<'kot' | 'bill' | null>(null);

  if (!session) return null;

  const testPrint = async (which: 'kot' | 'bill') => {
    setTesting(which);

    try {
      await (which === 'kot'
        ? printKotTicket(sampleKot(session))
        : printBill(sampleBill(session, settings.data)));
    } catch (error) {
      toast.error(error instanceof Error ? error : new Error('Printing is not available here.'));
    } finally {
      setTesting(null);
    }
  };

  return (
    <>
      <PageHeader
        title="KOT & bill printing"
        description="What the kitchen ticket and the customer bill carry, and the payment QR you print on bills."
      />

      <div className="space-y-6">
        {/* The only thing on this page that is actually a setting. Owners only:
            a payment code decides where a guest's money goes. */}
        {owner ? (
          <>
            <BillLogoCard />
            <PaymentQrCard />
          </>
        ) : (
          <Card>
            <CardBody>
              <p className="text-sm text-muted">
                The payment QR printed on bills is set by the restaurant owner.
              </p>
            </CardBody>
          </Card>
        )}

        <section aria-labelledby="documents-heading" className="space-y-3">
          <SectionHeading id="documents-heading">What each document carries</SectionHeading>

          <div className="grid gap-4 lg:grid-cols-2">
            <DocumentCard
              icon={<ChefHat className="size-4" aria-hidden />}
              title="Kitchen ticket (KOT)"
              description="Read at arm's length over a pass, then thrown away. Kept as short as the roll allows."
              fontSizePx={config.kot.fontSizePx}
              rows={[
                ['Table, in large type', config.kot.showTable],
                ['What was ordered, and how many', true],
                ["The table's special instructions", config.kot.showSpecialInstructions],
                ['Time the order was punched', config.kot.showOrderTime],
                ['Prices', config.kot.showPrices],
              ]}
              onTestPrint={() => void testPrint('kot')}
              testing={testing === 'kot'}
            />

            <DocumentCard
              icon={<Receipt className="size-4" aria-hidden />}
              title="Customer bill"
              description="Handed to a guest and sometimes kept for months, so it has to stand on its own as a tax invoice."
              fontSizePx={config.finalBill.fontSizePx}
              rows={[
                ['Your logo, at the very top', Boolean(settings.data?.logoUrl)],
                ['Your name, address and phone', config.finalBill.showRestaurantDetails],
                ['Bill number', config.finalBill.showInvoiceNumber],
                ['Every item, with prices', config.finalBill.showPrices],
                ['Discounts, with the reason', config.finalBill.showDiscounts],
                ['GSTIN, and each tax on its own line', config.finalBill.showGST],
                ['Whether it has been paid, and how', config.finalBill.showPaymentStatus],
                [
                  'Your payment QR, then a thank-you',
                  Boolean(settings.data?.printPaymentQr && settings.data.paymentQrUrl),
                ],
              ]}
              onTestPrint={() => void testPrint('bill')}
              testing={testing === 'bill'}
            />
          </div>
        </section>

        <section aria-labelledby="paper-heading" className="space-y-3">
          <SectionHeading id="paper-heading">The paper</SectionHeading>

          <Card>
            <CardBody className="space-y-5">
              <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                <Spec
                  icon={<Ruler className="size-4" aria-hidden />}
                  label="Roll"
                  value={`${config.paperWidthMm} mm`}
                  hint={`${printableWidthMm().toFixed(1)} mm printable`}
                />
                <Spec
                  icon={<Printer className="size-4" aria-hidden />}
                  label="Print head"
                  value={`${config.resolutionDpi} dpi`}
                  hint={`${config.printableDots} dots across`}
                />
                <Spec
                  icon={<Minus className="size-4" aria-hidden />}
                  label="Page length"
                  value="As long as the content"
                  hint="No blank paper after the last line"
                />
                <Spec
                  icon={<Scissors className="size-4" aria-hidden />}
                  label="Cut"
                  value={config.cutPaper ? 'After each document' : 'Manual'}
                  hint="Performed by the printer"
                />
              </dl>

              <p className="rounded-xl bg-ground/60 p-3 text-xs leading-relaxed text-muted ring-1 ring-line">
                Plateo prints through your browser to whichever printer the till already has
                installed, so the printer&rsquo;s own driver does the {config.encoding} and the cut.
                That is deliberate: the same button prints to a thermal roll, to A4, or to a PDF on
                the evening the roll printer jams and the kitchen still needs the ticket.
              </p>
            </CardBody>
          </Card>
        </section>
      </div>
    </>
  );
}

/** One printed document: what it carries, and a button to try it on real paper. */
function DocumentCard({
  icon,
  title,
  description,
  fontSizePx,
  rows,
  onTestPrint,
  testing,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  fontSizePx: number;
  rows: Array<[label: string, included: boolean]>;
  onTestPrint: () => void;
  testing: boolean;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title={title}
        description={description}
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ground px-2.5 py-1 text-xs font-medium text-muted ring-1 ring-line">
            <span className="text-brand-700">{icon}</span>
            {fontSizePx}px
          </span>
        }
      />
      <CardBody className="flex flex-1 flex-col gap-4">
        <ul className="space-y-2">
          {rows.map(([label, included]) => (
            <li key={label} className="flex items-start gap-2.5 text-sm">
              <span
                aria-hidden
                className={
                  included
                    ? 'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700'
                    : 'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-ground text-muted ring-1 ring-line'
                }
              >
                {included ? <Check className="size-3" /> : <Minus className="size-3" />}
              </span>
              <span className={included ? 'text-ink' : 'text-muted'}>
                {label}
                <span className="sr-only">{included ? ' — printed' : ' — not printed'}</span>
              </span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onTestPrint}
          disabled={testing}
          className="mt-auto inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-medium text-ink shadow-card transition-colors hover:bg-ground disabled:opacity-60"
        >
          <Printer className="size-4" aria-hidden />
          {testing ? 'Opening the print dialog…' : 'Print a test'}
        </button>
      </CardBody>
    </Card>
  );
}

function Spec({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-ground text-muted ring-1 ring-line"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="text-sm font-semibold text-ink">{value}</dd>
        <p className="text-xs text-muted">{hint}</p>
      </div>
    </div>
  );
}
