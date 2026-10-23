import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiResponse } from '../models/api.model';
import { AuthService } from './auth.service';

export interface TryOnStartResult { predictionId: string; status: string; productName: string; }
export interface TryOnStatusResult { predictionId: string; status: 'starting' | 'in_queue' | 'processing' | 'completed' | 'failed'; image: string | null; }

@Injectable({ providedIn: 'root' })
export class TryOnService {
  private readonly apiURL = `${environment.apiURL}try-on`;
  constructor(private http: HttpClient, private auth: AuthService) {}

  create(slug: string, audience: 'male' | 'female', style: 'studio' | 'minimal' | 'streetwear'): Observable<ApiResponse<TryOnStartResult>> {
    return this.http.post<ApiResponse<TryOnStartResult>>(`${this.apiURL}/${encodeURIComponent(slug)}`, { audience, style }, { headers: this.auth.authHeaders() });
  }

  status(predictionId: string): Observable<ApiResponse<TryOnStatusResult>> {
    return this.http.get<ApiResponse<TryOnStatusResult>>(`${this.apiURL}/jobs/${encodeURIComponent(predictionId)}`, { headers: this.auth.authHeaders() });
  }
}
