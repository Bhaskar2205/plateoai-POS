import type { INestApplication, LoggerService } from '@nestjs/common';

/**
 * Shutting down cleanly on the signals a platform uses to stop a container.
 *
 * Without this, Node is killed by the signal and exits non-zero; npm then reports
 * `npm error signal SIGTERM`, and the platform reads the ordinary end of a
 * deployment as a crash. That is worse than noise: it trains everyone to ignore
 * crash alerts, so the day something really does crash, nobody looks.
 *
 * Closing the app first also matters on a till. A deploy sends SIGTERM to the old
 * container while it may be halfway through settling a bill; `close()` lets
 * in-flight requests finish and shuts the database pool down rather than dropping
 * the connection mid-transaction.
 */

/** How long to wait for in-flight work before leaving anyway. */
export const FORCED_EXIT_MS = 10_000;

export const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

export interface ShutdownOptions {
  /** Injected so the behaviour can be tested without ending the test runner. */
  exit?: (code: number) => void;
  forcedExitMs?: number;
}

export function installShutdownHandlers(
  app: Pick<INestApplication, 'close'>,
  logger: LoggerService,
  { exit = (code) => process.exit(code), forcedExitMs = FORCED_EXIT_MS }: ShutdownOptions = {},
): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    // A platform may send SIGTERM and then SIGINT; the second must not start a
    // second shutdown on top of the first.
    if (shuttingDown) return;
    shuttingDown = true;

    logger.log?.(`${signal} received: finishing in-flight requests and shutting down.`);

    const forced = setTimeout(() => {
      logger.warn?.('Shutdown took too long; exiting anyway.');
      exit(0);
    }, forcedExitMs);

    // Never hold the process open just for this timer.
    forced.unref?.();

    try {
      await app.close();
      logger.log?.('Shutdown complete.');
    } catch (error) {
      // A failure to close is still a shutdown: log it and leave cleanly, or the
      // platform kills us and reports the crash we are trying to avoid.
      logger.error?.(`Shutdown failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(forced);
    }

    exit(0);
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => void shutdown(signal));
  }
}
