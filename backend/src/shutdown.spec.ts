import { installShutdownHandlers, SHUTDOWN_SIGNALS } from './shutdown';

/**
 * These cover the behaviour behind a "crashed" alert that was not a crash: a
 * deploy stops the old container with SIGTERM, and the process has to close its
 * work and exit 0 so a normal rollover does not look like a failure.
 */
describe('installShutdownHandlers', () => {
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  afterEach(() => {
    // Handlers are registered on the real process; leaving them would leak
    // between tests and fire on the runner's own signals.
    for (const signal of SHUTDOWN_SIGNALS) process.removeAllListeners(signal);
    jest.clearAllMocks();
  });

  it('closes the app and exits 0 on SIGTERM', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();

    installShutdownHandlers({ close }, logger, { exit });
    process.emit('SIGTERM');
    await new Promise(process.nextTick);

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('does the same on SIGINT, so Ctrl+C is not a crash either', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();

    installShutdownHandlers({ close }, logger, { exit });
    process.emit('SIGINT');
    await new Promise(process.nextTick);

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('shuts down once, however many signals arrive', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();

    installShutdownHandlers({ close }, logger, { exit });
    process.emit('SIGTERM');
    process.emit('SIGTERM');
    process.emit('SIGINT');
    await new Promise(process.nextTick);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('still exits 0 when closing fails, rather than being killed', async () => {
    const close = jest.fn().mockRejectedValue(new Error('pool is wedged'));
    const exit = jest.fn();

    installShutdownHandlers({ close }, logger, { exit });
    process.emit('SIGTERM');
    await new Promise(process.nextTick);

    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('pool is wedged'));
  });

  it('leaves anyway if closing never finishes', async () => {
    jest.useFakeTimers();

    const hardExit = jest.fn();
    // Never settles: something is holding a connection open.
    installShutdownHandlers({ close: () => new Promise(() => {}) }, logger, {
      hardExit,
      forcedExitMs: 50,
    });

    process.emit('SIGTERM');
    jest.advanceTimersByTime(60);

    expect(hardExit).toHaveBeenCalledWith(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('too long'));

    jest.useRealTimers();
  });

  /**
   * The regression that mattered: app.enableShutdownHooks() registers a handler
   * that ends with process.kill(process.pid, signal), re-raising the signal at
   * itself. With both installed, the process still died by SIGTERM and exited
   * non-zero, and the log line never reached the platform.
   */
  it('takes the signal over from a handler that would re-raise it', async () => {
    const reRaise = jest.fn();
    process.on('SIGTERM', reRaise);

    const close = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();

    installShutdownHandlers({ close }, logger, { exit });

    expect(process.listenerCount('SIGTERM')).toBe(1);

    process.emit('SIGTERM');
    await new Promise(process.nextTick);

    expect(reRaise).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('ends by letting the loop drain, so the last log lines are flushed', async () => {
    const hardExit = jest.fn();
    const previousExitCode = process.exitCode;

    // No injected exit: this exercises the real default.
    installShutdownHandlers({ close: jest.fn().mockResolvedValue(undefined) }, logger, {
      hardExit,
    });

    process.emit('SIGTERM');
    await new Promise(process.nextTick);

    expect(process.exitCode).toBe(0);
    // process.exit would cut off a pending write to the platform's log pipe.
    expect(hardExit).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Shutdown complete.'));

    process.exitCode = previousExitCode;
  });
});
