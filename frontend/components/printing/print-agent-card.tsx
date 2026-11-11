'use client';

import { CheckCircle2, Loader2, PlugZap, Printer, TriangleAlert, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  AGENT_URL,
  type AgentStatus,
  agentEnabled,
  agentStatus,
  setAgentEnabled,
} from '@/lib/print-agent';
import { Card, CardBody, CardHeader } from '@/components/ui/card';

/**
 * Direct printing, for this till.
 *
 * Printing through the browser hands the paper to the Windows driver, and the
 * driver decides the form length, the margins and the orientation - which is
 * how a restaurant got a bill sideways down two metres of blank roll. With the
 * Plateo Print Agent running on the till, Plateo sends the printer its own
 * commands instead: the receipt is as long as its lines, in the printer's own
 * type, and then it cuts.
 *
 * Per till, not per restaurant, because the agent and the printer addresses live
 * on the till. Connecting is a deliberate press here, because the first contact
 * with 127.0.0.1 makes Chrome ask the person at the till for permission, and
 * that question should only ever follow them asking for this.
 */
export function PrintAgentCard() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [missing, setMissing] = useState(false);

  // Only a till that was connected before is checked on load.
  useEffect(() => {
    const on = agentEnabled();
    setEnabled(on);
    if (!on) return;

    setChecking(true);
    void agentStatus().then((found) => {
      setStatus(found);
      setMissing(!found);
      setChecking(false);
    });
  }, []);

  const connect = async () => {
    setChecking(true);
    setMissing(false);
    const found = await agentStatus();
    setChecking(false);
    setStatus(found);

    if (found) {
      setAgentEnabled(true);
      setEnabled(true);
    } else {
      setMissing(true);
    }
  };

  const disconnect = () => {
    setAgentEnabled(false);
    setEnabled(false);
    setStatus(null);
    setMissing(false);
  };

  const noPrinter = status && !status.printers.bill;

  return (
    <Card>
      <CardHeader
        title="Direct printing on this till"
        description="Prints kitchen tickets and bills at the right length, with no blank paper and never sideways."
        action={
          enabled && status && !noPrinter ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-700">
              <CheckCircle2 className="size-3.5" aria-hidden />
              On
            </span>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {enabled && status ? (
          <>
            <dl className="grid gap-3 sm:grid-cols-2">
              <PrinterRow label="Bill printer" value={status.printers.bill} />
              <PrinterRow
                label="Kitchen (KOT) printer"
                value={status.printers.kot ?? (status.printers.bill ? 'Same as the bill printer' : null)}
              />
            </dl>

            {noPrinter ? (
              <Notice tone="warn">
                The agent is running but has no printer address yet. Open{' '}
                <a className="font-semibold underline" href={AGENT_URL} target="_blank" rel="noreferrer">
                  the agent&rsquo;s settings
                </a>{' '}
                on this till and enter the printer&rsquo;s IP. Until then this till prints through the
                browser.
              </Notice>
            ) : (
              <p className="text-sm text-muted">
                Every kitchen ticket and bill from this till now goes straight to the printer. Use{' '}
                <span className="font-medium text-ink">Print a test</span> below to check it on paper.
                If the printer cannot be reached, Plateo prints through the browser instead, so
                nothing is ever lost.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <a
                href={AGENT_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-ink shadow-card hover:bg-ground"
              >
                <Printer className="size-4" aria-hidden />
                Printer addresses
              </a>
              <button
                type="button"
                onClick={disconnect}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-muted hover:bg-ground"
              >
                <Unplug className="size-4" aria-hidden />
                Turn off on this till
              </button>
            </div>
          </>
        ) : (
          <>
            {enabled && missing ? (
              <Notice tone="warn">
                This till is set to print directly, but the Plateo Print Agent is not answering. Start
                it on this till; until then kitchen tickets and bills print through the browser.
              </Notice>
            ) : missing ? (
              <Notice tone="warn">
                No Plateo Print Agent found on this till. Install and start it, then press Connect
                again.
              </Notice>
            ) : null}

            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink">
              <li>Install the Plateo Print Agent on this till and start it.</li>
              <li>
                In the page it opens, enter the thermal printer&rsquo;s IP address and press{' '}
                <span className="font-medium">Test</span>.
              </li>
              <li>
                Come back here and press <span className="font-medium">Connect this till</span>.
                Chrome asks once whether Plateo may talk to the agent &mdash; choose Allow.
              </li>
            </ol>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void connect()}
                disabled={checking}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white shadow-card hover:bg-brand-700 disabled:opacity-60"
              >
                {checking ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <PlugZap className="size-4" aria-hidden />
                )}
                {checking ? 'Looking for the agent…' : 'Connect this till'}
              </button>
              {enabled ? (
                <button
                  type="button"
                  onClick={disconnect}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-muted hover:bg-ground"
                >
                  <Unplug className="size-4" aria-hidden />
                  Turn off on this till
                </button>
              ) : null}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function PrinterRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl bg-ground/60 p-3 ring-1 ring-line">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm font-semibold text-ink">{value ?? 'Not set'}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'warn'; children: React.ReactNode }) {
  return (
    <p
      className={
        tone === 'warn'
          ? 'flex gap-2 rounded-xl border border-warn-600/30 bg-warn-50 p-3 text-sm text-warn-600'
          : ''
      }
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
