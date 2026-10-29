import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { describeLoadError } from './load-error';

describe('describeLoadError', () => {
  it('classifies timeouts', () => {
    const error = new Error('Timeout has occurred');
    error.name = 'TimeoutError';
    expect(describeLoadError(error).kind).toBe('timeout');
  });

  it('classifies an unreachable backend (status 0)', () => {
    expect(describeLoadError(new HttpErrorResponse({ status: 0 })).kind).toBe('unreachable');
  });

  it('classifies a 2xx body that is not JSON (SPA HTML fallback)', () => {
    expect(describeLoadError(new HttpErrorResponse({ status: 200, error: { text: '<html>' } })).kind).toBe('not-json');
  });

  it('classifies server errors and rate limits without leaking details', () => {
    expect(describeLoadError(new HttpErrorResponse({ status: 503, error: 'mongodb://user:pw@host' })).message).not.toMatch(/mongodb|pw/);
    expect(describeLoadError(new HttpErrorResponse({ status: 429 })).kind).toBe('rate-limited');
  });

  it('classifies schema failures', () => {
    expect(describeLoadError(new Error('The product catalogue returned an unexpected response format.')).kind).toBe('bad-format');
  });
});
