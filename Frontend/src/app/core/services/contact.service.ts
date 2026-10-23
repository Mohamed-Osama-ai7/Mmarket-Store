import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiResponse, Pagination } from '../models/api.model';
import { IContactMessage } from '../models/contact.model';

export interface IContactListResponse extends ApiResponse<IContactMessage[]> { pagination: Pagination; }

@Injectable({ providedIn: 'root' })
export class ContactService {
  private readonly apiURL = `${environment.apiURL}contact`;
  constructor(private http: HttpClient) {}
  submit(message: { name: string; email: string; subject: string; message: string }): Observable<ApiResponse<{ id: string; status: string }>> {
    return this.http.post<ApiResponse<{ id: string; status: string }>>(this.apiURL, message);
  }
  getAdminMessages(page = 1, pageSize = 20, status = 'all'): Observable<IContactListResponse> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize).set('status', status);
    return this.http.get<IContactListResponse>(`${this.apiURL}/admin`, { params });
  }
  updateStatus(id: string, status: IContactMessage['status']): Observable<ApiResponse<IContactMessage>> {
    return this.http.patch<ApiResponse<IContactMessage>>(`${this.apiURL}/${id}/status`, { status });
  }
}
