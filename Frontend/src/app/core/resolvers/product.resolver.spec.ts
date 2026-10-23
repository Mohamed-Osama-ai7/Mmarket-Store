import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach } from 'vitest';
import { productResolver, ProductResolution } from './product.resolver';
import { ProductService } from '../services/product.service';
import { IProduct } from '../models/product.model';

describe('productResolver', () => {
  let productServiceMock: { getProductBySlug: (slug: string) => any };

  beforeEach(() => {
    productServiceMock = {
      getProductBySlug: () => of({ success: true, data: { _id: 'p1', name: 'Test Hat', slug: 'test-hat' } as IProduct })
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ProductService, useValue: productServiceMock }
      ]
    });
  });

  it('resolves product data for valid slug', async () => {
    const route = {
      paramMap: {
        get: (param: string) => (param === 'slug' ? 'test-hat' : null)
      }
    } as unknown as ActivatedRouteSnapshot;

    const res$ = TestBed.runInInjectionContext(() => productResolver(route, {} as any)) as any;
    const res = await new Promise<ProductResolution>((resolve) => res$.subscribe(resolve));

    expect(res.product).not.toBeNull();
    expect(res.product?.name).toBe('Test Hat');
    expect(res.errorMessage).toBe('');
    expect(res.retryable).toBe(false);
  });

  it('returns safe error when slug is missing from route', async () => {
    const route = {
      paramMap: {
        get: () => null
      }
    } as unknown as ActivatedRouteSnapshot;

    const res$ = TestBed.runInInjectionContext(() => productResolver(route, {} as any)) as any;
    const res = await new Promise<ProductResolution>((resolve) => res$.subscribe(resolve));

    expect(res.product).toBeNull();
    expect(res.errorMessage).toBe('A product identifier was not provided.');
    expect(res.retryable).toBe(false);
  });

  it('handles 404 not found cleanly as non-retryable', async () => {
    productServiceMock.getProductBySlug = () => throwError(() => ({ status: 404 }));

    const route = {
      paramMap: {
        get: (param: string) => (param === 'slug' ? 'unknown-item' : null)
      }
    } as unknown as ActivatedRouteSnapshot;

    const res$ = TestBed.runInInjectionContext(() => productResolver(route, {} as any)) as any;
    const res = await new Promise<ProductResolution>((resolve) => res$.subscribe(resolve));

    expect(res.product).toBeNull();
    expect(res.errorMessage).toContain('could not be found');
    expect(res.retryable).toBe(false);
  });

  it('handles 500 network error as retryable', async () => {
    productServiceMock.getProductBySlug = () => throwError(() => ({ status: 500 }));

    const route = {
      paramMap: {
        get: (param: string) => (param === 'slug' ? 'server-error-item' : null)
      }
    } as unknown as ActivatedRouteSnapshot;

    const res$ = TestBed.runInInjectionContext(() => productResolver(route, {} as any)) as any;
    const res = await new Promise<ProductResolution>((resolve) => res$.subscribe(resolve));

    expect(res.product).toBeNull();
    expect(res.errorMessage).toContain('Check your connection and try again');
    expect(res.retryable).toBe(true);
  });
});
