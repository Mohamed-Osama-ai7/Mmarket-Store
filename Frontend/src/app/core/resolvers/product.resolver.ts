import { ResolveFn } from '@angular/router';
import { inject } from '@angular/core';
import { catchError, map, of } from 'rxjs';
import { ProductService } from '../services/product.service';
import { IProduct } from '../models/product.model';

export interface ProductResolution {
  product: IProduct | null;
  errorMessage: string;
  retryable: boolean;
}

export const productResolver: ResolveFn<ProductResolution> = (route) => {
  const slug = route.paramMap.get('slug');
  if (!slug) return of({ product: null, errorMessage: 'A product identifier was not provided.', retryable: false });
  return inject(ProductService).getProductBySlug(slug).pipe(
    map((response) => response.data
      ? { product: response.data, errorMessage: '', retryable: false }
      : { product: null, errorMessage: 'This product is not available.', retryable: false }),
    catchError((error: unknown) => {
      const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
      const notFound = status === 404;
      return of({
        product: null,
        errorMessage: notFound
          ? 'This product could not be found. It may have been removed or is no longer available.'
          : 'We could not load this product. Check your connection and try again.',
        retryable: !notFound,
      });
    }),
  );
};
