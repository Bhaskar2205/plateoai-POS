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
 *
 * Note that `app.enableShutdownHooks()` does NOT achieve this and must not be used
 * alongside it. Nest's own handler finishes with `process.kill(process.pid, signal)`,
 * re-raising the signal at itself after removing every listener, so the process
 * still dies by the signal and still exits non-zero. `app.close()` below runs the
 * same lifecycle hooks (`onModuleDestroy`, `beforeApplicationShutdown`,
 * `onApplicationShutdown`) without that ending.
 */

/** How long to wait for in-flight work before leaving anyway. */
export const FORCED_EXIT_MS = 10_000;

export const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

export interface ShutdownOptions {
  /**
   * Ends the process normally. The default sets an exit code and lets the event
   * loop drain, rather than calling `process.exit`, so the last log lines are
   * flushed to the platform instead of being cut off mid-write.
   */
  exit?: (code: number) => void;
  /** Last resort when the loop will not drain. Injected so tests can watch it. */
  hardExit?: (code: number) => void;
  forcedExitMs?: number;
}

export function installShutdownHandlers(
  app: Pick<INestApplication, 'close'>,
  logger: LoggerService,
  {
    exit = (code) => {
      process.exitCode = code;
    },
    hardExit = (code) => process.exit(code),
    forcedExitMs = FORCED_EXIT_MS,
  }: ShutdownOptions = {},
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
      hardExit(0);
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
    // Take sole ownership of the signal. Anything else already listening - Nest's
    // own hooks, or a library's - may end by re-raising it, which kills the
    // process by the signal and undoes all of the above.
    process.removeAllListeners(signal);
    process.on(signal, () => void shutdown(signal));
  }
}
