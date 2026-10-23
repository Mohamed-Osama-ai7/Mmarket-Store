import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, timeout } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiResponse } from '../models/api.model';
import { IPayment } from '../models/shop.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly apiURL = `${environment.apiURL}payment`;
  constructor(private http: HttpClient, private auth: AuthService) {}

  createCashOnDelivery(orderId: string, idempotencyKey: string): Observable<ApiResponse<IPayment>> {
    const headers: HttpHeaders = this.auth.authHeaders().set('Idempotency-Key', idempotencyKey);
    return this.http.post<ApiResponse<IPayment>>(this.apiURL, { order: orderId, method: 'cash_on_delivery' }, { headers }).pipe(timeout({ first: 20000 }));
  }

  getMyPayments(): Observable<ApiResponse<IPayment[]>> {
    return this.http.get<ApiResponse<IPayment[]>>(this.apiURL, { headers: this.auth.authHeaders() }).pipe(timeout({ first: 15000 }));
  }

  getAdminPayments(): Observable<ApiResponse<IPayment[]>> {
    return this.http.get<ApiResponse<IPayment[]>>(`${this.apiURL}/admin`, { headers: this.auth.authHeaders() });
  }

  confirmCashOnDelivery(paymentId: string): Observable<ApiResponse<IPayment>> {
    return this.http.patch<ApiResponse<IPayment>>(`${this.apiURL}/${paymentId}/confirm-cash-on-delivery`, {}, { headers: this.auth.authHeaders() });
  }
}
