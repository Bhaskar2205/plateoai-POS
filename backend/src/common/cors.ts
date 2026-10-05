/**
 * Request headers the browser is allowed to send.
 *
 * This list is load-bearing in a way that is easy to miss. A header that is not
 * on it does not simply get dropped - it makes the preflight fail, and the
 * browser blocks the entire request. The API never sees it, so nothing appears
 * in the server logs, and the only symptom is a fetch that fails for no stated
 * reason.
 *
 * It bit exactly once already: adding `Idempotency-Key` to the diner's Place
 * order turned a working request into a blocked one, and every supertest-based
 * e2e test still passed because supertest does not enforce CORS. Hence the
 * spec next to this file - anything the browser sends has to be listed here.
 */
export const ALLOWED_REQUEST_HEADERS = [
  'Content-Type',
  'Authorization',
  /** Sent by the QR menu and the till on operations that must not run twice. */
  'Idempotency-Key',
  /** Lets a caller tie its own logs to the request id on an audit record. */
  'X-Request-Id',
] as const;

export const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] as const;
