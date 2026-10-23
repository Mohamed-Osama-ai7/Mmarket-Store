import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiResponse } from '../models/api.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ReportService {
  private readonly apiURL = `${environment.apiURL}report`;
  constructor(private http: HttpClient, private auth: AuthService) {}

  getSalesReport(fromDate?: string, toDate?: string): Observable<ApiResponse<Record<string, unknown>>> {
    let params = new HttpParams();
    if (fromDate) params = params.set('fromDate', fromDate);
    if (toDate) params = params.set('toDate', toDate);
    return this.http.get<ApiResponse<Record<string, unknown>>>(this.apiURL, { headers: this.auth.authHeaders(), params });
  }
}
