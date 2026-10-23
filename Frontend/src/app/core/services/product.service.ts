import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, timeout } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiResponse, Pagination } from '../models/api.model';
import { IProduct, IProductFilterOptions, IProductVariant } from '../models/product.model';
import { AuthService } from './auth.service';

export interface IProductListResponse extends ApiResponse<IProduct[]> {
  pagination: Pagination;
}

export type IProductFilterOptionsResponse = ApiResponse<IProductFilterOptions>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProductListResponse(value: unknown): IProductListResponse {
  if (!isRecord(value) || !Array.isArray(value['data'])) {
    throw new Error('The product catalogue returned an unexpected response format.');
  }

  const pagination = value['pagination'];
  if (!isRecord(pagination)) {
    throw new Error('The product catalogue returned invalid pagination metadata.');
  }

  const { page, pageSize, totalItems, totalPages } = pagination;
  if (
    !Number.isSafeInteger(page) || Number(page) < 1 ||
    !Number.isSafeInteger(pageSize) || Number(pageSize) < 1 ||
    !Number.isSafeInteger(totalItems) || Number(totalItems) < 0 ||
    !Number.isSafeInteger(totalPages) || Number(totalPages) < 0
  ) {
    throw new Error('The product catalogue returned invalid pagination metadata.');
  }

  return value as unknown as IProductListResponse;
}

function parseFilterOptionsResponse(value: unknown): IProductFilterOptionsResponse {
  if (!isRecord(value) || !isRecord(value['data'])) {
    throw new Error('The product filter endpoint returned an unexpected response format.');
  }

  const data = value['data'];
  if (![data['brands'], data['sizes'], data['colors']].every(items => Array.isArray(items) && items.every(item => typeof item === 'string'))) {
    throw new Error('The product filter endpoint returned invalid options.');
  }

  return value as unknown as IProductFilterOptionsResponse;
}

export interface ProductFilters {
  search?: string;
  category?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  brand?: string;
  size?: string;
  color?: string;
  minRating?: number | null;
  sort?: 'newest' | 'oldest' | 'price-asc' | 'price-desc' | 'name-asc';
}

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly apiURL = `${environment.apiURL}product`;
  readonly mediaURL = environment.mediaURL;

  constructor(private http: HttpClient, private auth: AuthService) {}

  getAllProducts(page = 1, pageSize = 12, filters: ProductFilters = {}): Observable<IProductListResponse> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (filters.search?.trim()) params = params.set('search', filters.search.trim());
    if (filters.category) params = params.set('category', filters.category);
    if (filters.minPrice !== null && filters.minPrice !== undefined) params = params.set('minPrice', filters.minPrice);
    if (filters.maxPrice !== null && filters.maxPrice !== undefined) params = params.set('maxPrice', filters.maxPrice);
    if (filters.brand?.trim()) params = params.set('brand', filters.brand.trim());
    if (filters.size?.trim()) params = params.set('size', filters.size.trim());
    if (filters.color?.trim()) params = params.set('color', filters.color.trim());
    if (filters.minRating !== null && filters.minRating !== undefined) params = params.set('minRating', filters.minRating);
    if (filters.sort) params = params.set('sort', filters.sort);
    return this.http.get<unknown>(this.apiURL, { params }).pipe(
      timeout({ first: 12000 }),
      map(parseProductListResponse),
    );
  }


  getFilterOptions(): Observable<IProductFilterOptionsResponse> {
    return this.http.get<unknown>(`${this.apiURL}/filters`).pipe(
      timeout({ first: 8000 }),
      map(parseFilterOptionsResponse),
    );
  }

  getProductBySlug(slug: string): Observable<ApiResponse<IProduct>> {
    return this.http.get<ApiResponse<IProduct>>(`${this.apiURL}/${encodeURIComponent(slug)}`).pipe(timeout({ first: 12000 }));
  }

  createProduct(formData: FormData): Observable<ApiResponse<IProduct>> {
    return this.http.post<ApiResponse<IProduct>>(this.apiURL, formData, { headers: this.auth.authHeaders() });
  }

  updateProduct(id: string, formData: FormData): Observable<ApiResponse<IProduct>> {
    return this.http.put<ApiResponse<IProduct>>(`${this.apiURL}/${id}`, formData, { headers: this.auth.authHeaders() });
  }

  deleteProduct(id: string): Observable<ApiResponse<IProduct>> {
    return this.http.delete<ApiResponse<IProduct>>(`${this.apiURL}/${id}`, { headers: this.auth.authHeaders() });
  }

  imageUrl(filename?: string): string {
    if (!filename || typeof filename !== 'string') return '/product-placeholder.svg';
    // Seeded catalogue photography is HTTPS-only. Restrict embedded data URLs to raster images.
    if (/^https:\/\//i.test(filename)) return filename;
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(filename)) return filename;
    if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(filename)) return filename;
    // Admin uploads use UUID filenames, never arbitrary filesystem paths.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(filename) || filename === '.' || filename === '..') return '/product-placeholder.svg';
    return `${this.mediaURL}${encodeURIComponent(filename)}`;
  }

  hasLocalProductImage(product: IProduct): boolean {
    return [product.imgURL, ...(product.images || [])].some(value => typeof value === 'string' && value.trim() !== '' && !/^(?:https?:)?\/\//i.test(value) && !/^data:/i.test(value) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(value) && value !== '.' && value !== '..');
  }

  variantFor(product: IProduct, variantId?: string): IProductVariant | undefined {
    if (!variantId || !Array.isArray(product.variants)) return undefined;
    return product.variants.find(variant => variant._id === variantId && variant.isActive !== false);
  }

  priceFor(product: IProduct, variantId?: string): number {
    return this.variantFor(product, variantId)?.price ?? product.price;
  }

  startingPrice(product: IProduct): number {
    const available = (product.variants || []).filter(variant => variant.isActive !== false && variant.stock > 0);
    if (!available.length) return product.price;
    return Math.min(...available.map(variant => variant.price ?? product.price));
  }

  hasVariablePrice(product: IProduct): boolean {
    const available = (product.variants || []).filter(variant => variant.isActive !== false && variant.stock > 0);
    return new Set(available.map(variant => variant.price ?? product.price)).size > 1;
  }
}
