import { Injectable, PLATFORM_ID, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError, timeout } from 'rxjs';
import { catchError, finalize, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/env';
import { ApiResponse } from '../models/api.model';
import { ICart, ICartItem } from '../models/shop.model';
import { IProduct } from '../models/product.model';
import { AuthService } from './auth.service';
import { ProductService } from './product.service';

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly apiURL = `${environment.apiURL}cart`;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly guestCartKey = 'marketGuestCartV1';
  private readonly guestCartIdKey = 'marketGuestCartIdV1';
  private guestMergeInFlight: Observable<ApiResponse<ICart>> | null = null;
  private readonly cartSubject = new BehaviorSubject<ICart | null>(null);
  readonly cart$ = this.cartSubject.asObservable();
  readonly cartCount$ = this.cart$.pipe(map((cart) => cart?.totalItems || 0));
  // Signals: synchronous UI state derived from the cart stream. HTTP and sync stay on RxJS.
  readonly cart = toSignal(this.cart$, { initialValue: this.cartSubject.value });
  readonly cartCount = computed(() => this.cart()?.totalItems || 0);
  readonly cartTotal = computed(() => this.cart()?.totalPrice || 0);

  constructor(private http: HttpClient, private auth: AuthService, private products: ProductService) {
    // Read browser storage only after Angular has assigned constructor-injected services.
    this.cartSubject.next(this.readGuestCart());
  }

  getCart(): Observable<ApiResponse<ICart>> {
    if (!this.auth.isLoggedIn) {
      const cart = this.readGuestCart();
      this.cartSubject.next(cart);
      return of({ message: 'Guest cart retrieved', data: cart });
    }
    if (isPlatformBrowser(this.platformId)) {
      const guestCart = this.readGuestCart();
      if (guestCart.items.length) {
        return this.mergeGuestCartRequest(guestCart).pipe(
          catchError((err) => {
            try { localStorage.removeItem(this.guestCartKey); localStorage.removeItem(this.guestCartIdKey); } catch { /* Storage is optional. */ }
            return this.http.get<ApiResponse<ICart>>(this.apiURL, { headers: this.auth.authHeaders() }).pipe(
              timeout({ first: 15000 }),
              tap((response) => this.cartSubject.next(response.data)),
            );
          })
        );
      }
    }
    return this.http.get<ApiResponse<ICart>>(this.apiURL, { headers: this.auth.authHeaders() }).pipe(
      timeout({ first: 15000 }),
      tap((response) => this.cartSubject.next(response.data)),
    );
  }

  refreshCart(): void {
    if (!this.auth.isLoggedIn) { this.resetLocalState(); return; }
    this.syncGuestCartToAccount();
  }

  syncGuestCartToAccount(): void {
    if (!this.auth.isLoggedIn) { this.resetLocalState(); return; }
    this.getCart().subscribe({ error: () => undefined });
  }

  private mergeGuestCartRequest(guestCart: ICart): Observable<ApiResponse<ICart>> {
    if (this.guestMergeInFlight) return this.guestMergeInFlight;
    let guestCartId = '';
    try { guestCartId = localStorage.getItem(this.guestCartIdKey) || ''; } catch { /* Storage is optional. */ }
    if (!guestCartId) {
      guestCartId = globalThis.crypto?.randomUUID?.().replace(/-/g, '') || `${Date.now()}${Math.random().toString(36).slice(2)}`;
      try { localStorage.setItem(this.guestCartIdKey, guestCartId); } catch { /* Storage is optional. */ }
    }
    const payload = { guestCartId, items: guestCart.items.map(item => ({ product: item.product._id, quantity: item.quantity, ...(item.variantId ? { variantId: item.variantId } : {}) })) };
    const request = this.http.post<ApiResponse<ICart>>(`${this.apiURL}/merge-guest`, payload, { headers: this.auth.authHeaders() }).pipe(
      // The persistent guestCartId makes this merge idempotent if the client times out after a server commit.
      timeout({ first: 15000 }),
      tap(response => {
        try { localStorage.removeItem(this.guestCartKey); localStorage.removeItem(this.guestCartIdKey); } catch { /* Storage is optional. */ }
        this.cartSubject.next(response.data);
      }),
      catchError((error) => {
        this.guestMergeInFlight = null;
        return throwError(() => error);
      }),
      finalize(() => { this.guestMergeInFlight = null; }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.guestMergeInFlight = request;
    return request;
  }

  resetLocalState(): void { this.cartSubject.next(this.readGuestCart()); }

  add(productId: string, quantity = 1, product?: IProduct, variantId?: string): Observable<ApiResponse<ICart>> {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return throwError(() => new Error('Choose a quantity between 1 and 20.'));
    if (!this.auth.isLoggedIn) {
      if (!product || product._id !== productId) return throwError(() => new Error('Product details are required to add an item to a guest cart.'));
      if (product.variants?.length && !variantId) return throwError(() => new Error('Choose a size and color before adding this product.'));
      const variant = this.products.variantFor(product, variantId);
      if (variantId && !variant) return throwError(() => new Error('This product option is no longer available.'));
      const availableStock = variant?.stock ?? product.stock;
      const cart = this.readGuestCart();
      // Migrate an old guest-cart line that predates SKU-level variants. Keeping it would make
      // checkout ambiguous because the old line has no selected size/color.
      if (product.variants?.length && variantId) {
        cart.items = cart.items.filter((item) => !(item.product._id === productId && !item.variantId));
      }
      const existing = cart.items.find((item) => item.product._id === productId && (item.variantId || '') === (variantId || ''));
      const nextQuantity = (existing?.quantity || 0) + quantity;
      if (nextQuantity > availableStock) return throwError(() => new Error('The requested quantity exceeds the stock for this option.'));
      if (existing) existing.quantity = nextQuantity;
      else cart.items.push({ product, quantity, ...(variantId ? { variantId } : {}) });
      return of(this.saveGuestCart(cart));
    }
    return this.http.post<ApiResponse<ICart>>(this.apiURL, { product: productId, quantity, ...(variantId ? { variantId } : {}) }, { headers: this.auth.authHeaders() }).pipe(
      tap((response) => this.cartSubject.next(response.data)),
    );
  }

  update(productId: string, quantity: number, variantId?: string): Observable<ApiResponse<ICart>> {
    if (!this.auth.isLoggedIn) {
      const cart = this.readGuestCart();
      const item = cart.items.find((entry) => entry.product._id === productId && (entry.variantId || '') === (variantId || ''));
      if (!item) return throwError(() => new Error('This item is no longer in your guest cart.'));
      if (item.variantUnavailable) return throwError(() => new Error('This option is no longer available. Remove it and choose another option.'));
      const variant = this.products.variantFor(item.product, item.variantId);
      const stockLimit = variant?.stock ?? item.product.stock;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20 || quantity > stockLimit) return throwError(() => new Error('Choose a quantity within the available stock.'));
      item.quantity = quantity;
      return of(this.saveGuestCart(cart));
    }
    let params = new HttpParams();
    if (variantId) params = params.set('variantId', variantId);
    return this.http.put<ApiResponse<ICart>>(`${this.apiURL}/${productId}`, { quantity }, { headers: this.auth.authHeaders(), params }).pipe(
      tap((response) => this.cartSubject.next(response.data)),
    );
  }

  remove(productId: string, variantId?: string): Observable<ApiResponse<ICart>> {
    if (!this.auth.isLoggedIn) {
      const cart = this.readGuestCart();
      cart.items = cart.items.filter((entry) => !(entry.product._id === productId && (variantId ? (entry.variantId || '') === variantId : !entry.variantId)));
      return of(this.saveGuestCart(cart));
    }
    let params = new HttpParams().set('variantId', variantId || 'none');
    return this.http.delete<ApiResponse<ICart>>(`${this.apiURL}/${productId}`, { headers: this.auth.authHeaders(), params }).pipe(
      tap((response) => this.cartSubject.next(response.data)),
    );
  }

  clear(): Observable<ApiResponse<ICart>> {
    if (!this.auth.isLoggedIn) return of(this.saveGuestCart({ items: [], totalItems: 0, totalPrice: 0 }));
    return this.http.delete<ApiResponse<ICart>>(this.apiURL, { headers: this.auth.authHeaders() }).pipe(
      tap(() => this.cartSubject.next({ items: [], totalItems: 0, totalPrice: 0 })),
    );
  }

  linePrice(item: ICartItem): number { return item.productUnavailable || item.variantUnavailable ? 0 : this.products.priceFor(item.product, item.variantId); }
  variantLabel(item: ICartItem): string {
    const variant = this.products.variantFor(item.product, item.variantId);
    if (item.variantUnavailable) return '';
    if (!variant) return '';
    return [variant.size, variant.color].filter(Boolean).join(' · ');
  }

  private saveGuestCart(cart: ICart): ApiResponse<ICart> {
    const items = cart.items.map(item => ({ ...item, productUnavailable: item.product.isActive === false, variantUnavailable: item.product.isActive !== false && Boolean(item.product.variants?.length && !this.products.variantFor(item.product, item.variantId)) }));
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = Number(items.reduce((sum, item) => sum + this.linePrice(item) * item.quantity, 0).toFixed(2));
    const normalized: ICart = { items, totalItems, totalPrice };
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(this.guestCartKey, JSON.stringify(normalized));
        if (!normalized.items.length) localStorage.removeItem(this.guestCartIdKey);
      } catch { /* Private browsing/storage quotas must not crash checkout UI. */ }
    }
    this.cartSubject.next(normalized);
    return { message: 'Guest cart updated', data: normalized };
  }

  private readGuestCart(): ICart {
    const empty: ICart = { items: [], totalItems: 0, totalPrice: 0 };
    if (!isPlatformBrowser(this.platformId)) return empty;
    try {
      const raw = localStorage.getItem(this.guestCartKey);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) as Partial<ICart>;
      if (!Array.isArray(parsed.items)) return empty;
      const items = parsed.items.filter((item): item is ICartItem => Boolean(item && item.product && typeof item.product._id === 'string' && Number.isInteger(item.quantity) && item.quantity > 0 && Number.isFinite(item.product.price))).map(item => ({ ...item, variantUnavailable: Boolean(item.product.variants?.length && !this.products.variantFor(item.product, item.variantId)) }));
      return { items, totalItems: items.reduce((sum, item) => sum + item.quantity, 0), totalPrice: Number(items.reduce((sum, item) => sum + (item.productUnavailable || item.variantUnavailable ? 0 : this.linePrice(item) * item.quantity), 0).toFixed(2)) };
    } catch { return empty; }
  }
}
