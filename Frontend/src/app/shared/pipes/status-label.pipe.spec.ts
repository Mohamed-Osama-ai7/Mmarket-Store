import { describe, it, expect } from 'vitest';
import { StatusLabelPipe } from './status-label.pipe';

describe('StatusLabelPipe', () => {
  const pipe = new StatusLabelPipe();

  it('transforms snake_case status to Title Case', () => {
    expect(pipe.transform('partially_refunded')).toBe('Partially Refunded');
    expect(pipe.transform('cash_on_delivery')).toBe('Cash On Delivery');
  });

  it('transforms kebab-case status to Title Case', () => {
    expect(pipe.transform('out-of-stock')).toBe('Out Of Stock');
    expect(pipe.transform('in-transit')).toBe('In Transit');
  });

  it('transforms simple status to capitalized string', () => {
    expect(pipe.transform('pending')).toBe('Pending');
    expect(pipe.transform('completed')).toBe('Completed');
    expect(pipe.transform('approved')).toBe('Approved');
  });

  it('handles null, undefined, and empty string safely', () => {
    expect(pipe.transform(null)).toBe('Unknown');
    expect(pipe.transform(undefined)).toBe('Unknown');
    expect(pipe.transform('')).toBe('Unknown');
  });
});
