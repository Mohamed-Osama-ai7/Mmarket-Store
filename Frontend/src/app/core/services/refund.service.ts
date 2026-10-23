import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, timeout } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiResponse } from '../models/api.model';
import { IRefund } from '../models/shop.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class RefundService {
  private readonly apiURL = `${environment.apiURL}refunds`;
  constructor(private http: HttpClient, private auth: AuthService) {}

  getMine(): Observable<ApiResponse<IRefund[]>> {
    return this.http.get<ApiResponse<IRefund[]>>(this.apiURL, { headers: this.auth.authHeaders() }).pipe(timeout({ first: 15000 }));
  }

  request(paymentId: string, amount: number, reason: string, idempotencyKey: string): Observable<ApiResponse<IRefund>> {
    const headers = this.auth.authHeaders().set('Idempotency-Key', idempotencyKey);
    return this.http.post<ApiResponse<IRefund>>(this.apiURL, { payment: paymentId, amount, reason }, { headers }).pipe(timeout({ first: 20000 }));
  }

  getAdminRefunds(): Observable<ApiResponse<IRefund[]>> {
    const params = new HttpParams().set('limit', 100);
    return this.http.get<ApiResponse<IRefund[]>>(`${this.apiURL}/admin`, { headers: this.auth.authHeaders(), params });
  }

  review(id: string, decision: 'approve' | 'reject', reviewNote: string): Observable<ApiResponse<IRefund>> {
    return this.http.patch<ApiResponse<IRefund>>(`${this.apiURL}/${id}/review`, { decision, reviewNote }, { headers: this.auth.authHeaders() });
  }

  startProcessing(id: string): Observable<ApiResponse<IRefund>> {
    return this.http.patch<ApiResponse<IRefund>>(`${this.apiURL}/${id}/process`, {}, { headers: this.auth.authHeaders() });
  }

  // The API requires the manual refund confirmation reference (providerRefundId) to record completion.
  complete(id: string, providerRefundId: string): Observable<ApiResponse<IRefund>> {
    return this.http.patch<ApiResponse<IRefund>>(`${this.apiURL}/${id}/complete`, { providerRefundId }, { headers: this.auth.authHeaders() });
  }

  fail(id: string, failureReason: string): Observable<ApiResponse<IRefund>> {
    return this.http.patch<ApiResponse<IRefund>>(`${this.apiURL}/${id}/fail`, { failureReason }, { headers: this.auth.authHeaders() });
  }
}
