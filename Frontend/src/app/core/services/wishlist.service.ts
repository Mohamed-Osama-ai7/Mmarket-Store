import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, timeout } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiResponse } from '../models/api.model';
import { IProduct } from '../models/product.model';
import { AuthService } from './auth.service';

export interface IWishlist {
  products: IProduct[];
  totalProducts: number;
}

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private readonly apiURL = `${environment.apiURL}wishlist`;
  private readonly savedIdsSubject = new BehaviorSubject<ReadonlySet<string>>(new Set<string>());
  private refreshGeneration = 0;
  private stateRevision = 0;
  readonly savedIds$ = this.savedIdsSubject.asObservable();

  constructor(private http: HttpClient, private auth: AuthService) {}

  getAll(): Observable<ApiResponse<IWishlist>> {
    return this.http.get<ApiResponse<IWishlist>>(this.apiURL, { headers: this.auth.authHeaders() }).pipe(timeout({ first: 12000 }));
  }

  refresh(): void {
    if (!this.auth.isLoggedIn) { this.resetState(); return; }
    const generation = ++this.refreshGeneration;
    const revision = this.stateRevision;
    this.getAll().subscribe({
      next: response => { if (generation === this.refreshGeneration && revision === this.stateRevision) this.syncProducts(response.data?.products || []); },
      error: () => { /* Keep the last known saved state; the wishlist page exposes retryable errors. */ },
    });
  }

  syncProducts(products: IProduct[]): void {
    this.stateRevision += 1;
    this.savedIdsSubject.next(new Set(products.map(product => product._id)));
  }

  resetState(): void {
    this.refreshGeneration += 1;
    this.stateRevision += 1;
    this.savedIdsSubject.next(new Set<string>());
  }

  add(productId: string): Observable<ApiResponse<IWishlist>> {
    return this.http.post<ApiResponse<IWishlist>>(`${this.apiURL}/${productId}`, {}, { headers: this.auth.authHeaders() }).pipe(
      timeout({ first: 12000 }),
      tap(() => this.updateSavedId(productId, true)),
    );
  }

  remove(productId: string): Observable<ApiResponse<IWishlist>> {
    return this.http.delete<ApiResponse<IWishlist>>(`${this.apiURL}/${productId}`, { headers: this.auth.authHeaders() }).pipe(
      timeout({ first: 12000 }),
      tap(() => this.updateSavedId(productId, false)),
    );
  }

  clear(): Observable<ApiResponse<IWishlist>> {
    return this.http.delete<ApiResponse<IWishlist>>(this.apiURL, { headers: this.auth.authHeaders() }).pipe(
      timeout({ first: 12000 }),
      tap(() => this.resetState()),
    );
  }

  private updateSavedId(productId: string, saved: boolean): void {
    this.stateRevision += 1;
    const next = new Set(this.savedIdsSubject.value);
    if (saved) next.add(productId); else next.delete(productId);
    this.savedIdsSubject.next(next);
  }
}
