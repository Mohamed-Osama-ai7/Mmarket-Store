import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiResponse } from '../models/api.model';
import { IReview } from '../models/shop.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly apiURL = `${environment.apiURL}review`;
  constructor(private http: HttpClient, private auth: AuthService) {}

  getProductReviews(productId: string): Observable<ApiResponse<{ reviews: IReview[]; totalReviews: number }>> {
    return this.http.get<ApiResponse<{ reviews: IReview[]; totalReviews: number }>>(`${this.apiURL}/product/${productId}`);
  }

  create(productId: string, rating: number, comment: string): Observable<ApiResponse<IReview>> {
    return this.http.post<ApiResponse<IReview>>(`${this.apiURL}/${productId}`, { rating, comment }, { headers: this.auth.authHeaders() });
  }
}
