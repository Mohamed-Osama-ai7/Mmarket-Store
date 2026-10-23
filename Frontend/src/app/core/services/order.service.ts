import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, timeout } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiResponse } from '../models/api.model';
import { IOrder, OrderStatus } from '../models/shop.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly apiURL = `${environment.apiURL}order`;
  constructor(private http: HttpClient, private auth: AuthService) {}

  checkout(idempotencyKey: string, deliveryDetails: { name: string; phone: string; address: string }): Observable<ApiResponse<IOrder>> {
    const headers = this.auth.authHeaders().set('Idempotency-Key', idempotencyKey);
    return this.http.post<ApiResponse<IOrder>>(`${this.apiURL}/checkout`, { deliveryDetails }, { headers }).pipe(timeout({ first: 20000 }));
  }


  getGuestOrder(id: string, accessToken: string): Observable<ApiResponse<IOrder>> {
    const headers = new HttpHeaders({ 'X-Guest-Order-Token': accessToken });
    return this.http.get<ApiResponse<IOrder>>(`${this.apiURL}/guest/${encodeURIComponent(id)}`, { headers });
  }

  cancelGuestOrder(id: string, accessToken: string): Observable<ApiResponse<IOrder>> {
    const headers = new HttpHeaders({ 'X-Guest-Order-Token': accessToken });
    return this.http.patch<ApiResponse<IOrder>>(`${this.apiURL}/guest/${encodeURIComponent(id)}/cancel`, {}, { headers });
  }

  getMyOrders(): Observable<ApiResponse<IOrder[]>> {
    return this.http.get<ApiResponse<IOrder[]>>(this.apiURL, { headers: this.auth.authHeaders() }).pipe(timeout({ first: 15000 }));
  }

  getById(id: string): Observable<ApiResponse<IOrder>> {
    return this.http.get<ApiResponse<IOrder>>(`${this.apiURL}/${id}`, { headers: this.auth.authHeaders() });
  }

  getAdminOrders(): Observable<ApiResponse<IOrder[]>> {
    const params = new HttpParams().set('page', 1).set('pageSize', 100);
    return this.http.get<ApiResponse<IOrder[]>>(`${this.apiURL}/admin`, { headers: this.auth.authHeaders(), params });
  }

  cancelMyOrder(id: string): Observable<ApiResponse<IOrder>> {
    return this.http.patch<ApiResponse<IOrder>>(`${this.apiURL}/${id}/cancel`, {}, { headers: this.auth.authHeaders() }).pipe(timeout({ first: 15000 }));
  }

  updateStatus(id: string, status: OrderStatus): Observable<ApiResponse<IOrder>> {
    return this.http.patch<ApiResponse<IOrder>>(`${this.apiURL}/${id}/status`, { status }, { headers: this.auth.authHeaders() });
  }
}
