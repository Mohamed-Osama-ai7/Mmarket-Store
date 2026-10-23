import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { ProductService } from './product.service';

describe('ProductService catalogue contract', () => {
  let service: ProductService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { authHeaders: vi.fn() } },
      ],
    });
    service = TestBed.inject(ProductService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('sends normalized filters and accepts the backend data/pagination contract', () => {
    let actual: unknown;
    service.getAllProducts(2, 6, { search: '  linen  ', brand: 'Northline', minPrice: 10, sort: 'price-asc' })
      .subscribe(response => actual = response);

    const request = http.expectOne(req => req.url === '/api/v1/product');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('pageSize')).toBe('6');
    expect(request.request.params.get('search')).toBe('linen');
    expect(request.request.params.get('brand')).toBe('Northline');
    expect(request.request.params.get('minPrice')).toBe('10');
    expect(request.request.params.get('sort')).toBe('price-asc');

    request.flush({
      message: 'Products list',
      data: [{ _id: 'p1', name: 'Linen shirt', slug: 'linen-shirt' }],
      pagination: { page: 2, pageSize: 6, totalItems: 7, totalPages: 2 },
    });

    expect(actual).toEqual(expect.objectContaining({
      data: [expect.objectContaining({ _id: 'p1' })],
      pagination: { page: 2, pageSize: 6, totalItems: 7, totalPages: 2 },
    }));
  });

  it('rejects a successful HTTP response with a mismatched product-list body', () => {
    let failure: unknown;
    service.getAllProducts().subscribe({ error: error => failure = error });

    http.expectOne(req => req.url === '/api/v1/product').flush({ products: [] });

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('unexpected response format');
  });

  it('rejects malformed filter options rather than silently accepting them', () => {
    let failure: unknown;
    service.getFilterOptions().subscribe({ error: error => failure = error });

    http.expectOne('/api/v1/product/filters').flush({ data: { brands: 'Northline', sizes: [], colors: [] } });

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('invalid options');
  });
});
