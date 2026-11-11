/**
 * Talking to the Plateo Print Agent on this till.
 *
 * A website cannot open a socket to a printer on the restaurant's network, and
 * the API cannot reach it either - the printer sits behind the restaurant's
 * router. The agent is the bridge: a small program on the till that listens on
 * 127.0.0.1 only and forwards ESC/POS bytes to the printer's port 9100. Which
 * printer is which lives in the agent on that till, never in the cloud.
 *
 * Opt-in per till, and remembered per browser. Probing 127.0.0.1 from a public
 * site makes Chrome ask the person at the till for permission, so a till that
 * has never been connected is never probed - it keeps printing through the
 * browser exactly as before, with no prompt and no delay.
 */

export const AGENT_URL = 'http://127.0.0.1:9123';

const ENABLED_KEY = 'plateo.printAgent.enabled';

export type PrinterRole = 'kot' | 'bill';

export interface AgentStatus {
  ok: true;
  agent: 'plateo-print-agent';
  version: string;
  printers: { bill: string | null; kot: string | null };
}

export type AgentResult =
  | { ok: true; printer: string }
  /**
   * `fallback` is true only when nothing reached the printer - the agent is not
   * running, has no printer for this job, or could not connect - so printing
   * the same thing through the browser cannot produce a second copy.
   */
  | { ok: false; fallback: boolean; message: string };

export function agentEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAgentEnabled(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(ENABLED_KEY, '1');
    else window.localStorage.removeItem(ENABLED_KEY);
  } catch {
    // Private windows refuse storage; this till simply stays on the browser path.
  }
}

/**
 * Fetch, told that the target is this machine.
 *
 * `targetAddressSpace` is Chrome's Local Network Access hint: it lets an https
 * page ask for a loopback address explicitly, and it is ignored by browsers that
 * do not know it.
 */
function agentFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(`${AGENT_URL}${path}`, {
    ...init,
    signal: controller.signal,
    targetAddressSpace: 'loopback',
  } as RequestInit & { targetAddressSpace: string }).finally(() => clearTimeout(timer));
}

/** The agent and the printers it knows, or null when it is not running here. */
export async function agentStatus(timeoutMs = 2500): Promise<AgentStatus | null> {
  try {
    const response = await agentFetch('/status', { method: 'GET' }, timeoutMs);
    if (!response.ok) return null;

    const body = (await response.json()) as AgentStatus;
    return body?.agent === 'plateo-print-agent' ? body : null;
  } catch {
    return null;
  }
}

/** Sends one job to the printer that does this kind of job. */
export async function sendToAgent(role: PrinterRole, data: Uint8Array): Promise<AgentResult> {
  let response: Response;

  try {
    response = await agentFetch(
      `/print?role=${role}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data as BodyInit,
      },
      15_000,
    );
  } catch {
    // Not running, blocked, or never answered: nothing was printed.
    return { ok: false, fallback: true, message: 'The Plateo Print Agent is not running on this till.' };
  }

  const body = (await response.json().catch(() => null)) as
    | { ok: true; printer: string }
    | { ok: false; stage?: string; message?: string }
    | null;

  if (body?.ok) return { ok: true, printer: body.printer };

  // Only a failure before the first byte left is safe to retry another way. A
  // failure mid-write may already have put half a bill on paper.
  const stage = body && !body.ok ? body.stage : undefined;

  return {
    ok: false,
    fallback: stage === 'config' || stage === 'connect',
    message: (body && !body.ok && body.message) || `The print agent answered ${response.status}.`,
  };
}
