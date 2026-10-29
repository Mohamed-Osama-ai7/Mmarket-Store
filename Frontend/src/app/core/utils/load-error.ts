import { HttpErrorResponse } from '@angular/common/http';

export type LoadErrorKind = 'timeout' | 'unreachable' | 'not-json' | 'bad-format' | 'rate-limited' | 'server' | 'other';

export interface LoadError {
  kind: LoadErrorKind;
  message: string;
}

/**
 * Classifies a failed catalogue/content request into a shopper-safe message.
 * Never exposes stack traces, hostnames, or backend operational hints.
 */
export function describeLoadError(error: unknown, subject = 'the store'): LoadError {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return { kind: 'timeout', message: `${subject} is taking longer than usual to respond. The server may be waking up — please try again in a moment.` };
  }
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return { kind: 'unreachable', message: `We can't reach ${subject} right now. Check your connection and try again.` };
    }
    if (error.status === 200 || (error.status >= 200 && error.status < 300)) {
      // HttpClient reports a 2xx body it could not parse (for example the SPA's HTML) as a parse failure.
      return { kind: 'not-json', message: `${subject} sent an unexpected response. Please try again shortly.` };
    }
    if (error.status === 429) {
      return { kind: 'rate-limited', message: 'Too many requests in a short time. Please wait a few seconds and try again.' };
    }
    if (error.status >= 500) {
      return { kind: 'server', message: `${subject} is temporarily unavailable. Please try again in a moment.` };
    }
  }
  if (error instanceof Error && /unexpected response format|invalid (pagination|options)/i.test(error.message)) {
    return { kind: 'bad-format', message: `${subject} returned data we could not read. Please try again shortly.` };
  }
  return { kind: 'other', message: `Something went wrong while loading ${subject}. Please try again.` };
}
