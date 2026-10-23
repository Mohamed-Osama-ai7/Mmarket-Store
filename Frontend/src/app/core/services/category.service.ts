import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiResponse } from '../models/api.model';
import { ICategory } from '../models/product.model';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private readonly apiURL = `${environment.apiURL}category`;

  constructor(private http: HttpClient, private auth: AuthService) {}

  getAll(): Observable<ApiResponse<ICategory[]>> {
    return this.http.get<ApiResponse<ICategory[]>>(this.apiURL);
  }

  getBySlug(slug: string): Observable<ApiResponse<ICategory>> {
    return this.http.get<ApiResponse<ICategory>>(`${this.apiURL}/${encodeURIComponent(slug)}`);
  }

  create(name: string): Observable<ApiResponse<ICategory>> {
    return this.http.post<ApiResponse<ICategory>>(this.apiURL, { name }, { headers: this.auth.authHeaders() });
  }

  update(id: string, name: string): Observable<ApiResponse<ICategory>> {
    return this.http.put<ApiResponse<ICategory>>(`${this.apiURL}/${id}`, { name }, { headers: this.auth.authHeaders() });
  }

  remove(id: string): Observable<ApiResponse<ICategory>> {
    return this.http.delete<ApiResponse<ICategory>>(`${this.apiURL}/${id}`, { headers: this.auth.authHeaders() });
  }
}
