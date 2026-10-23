import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, timeout } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiResponse } from '../models/api.model';
import { IContentPage, IContentPageInput, ISiteContent, ISiteContentUpdate } from '../models/site-content.model';

@Injectable({ providedIn: 'root' })
export class SiteContentService {
  private readonly apiURL = `${environment.apiURL}site-content`;

  constructor(private http: HttpClient) {}

  getPublicContent(): Observable<ApiResponse<ISiteContent>> {
    return this.http.get<ApiResponse<ISiteContent>>(`${this.apiURL}/public`).pipe(timeout({ first: 8000 }));
  }

  getPublicPage(slug: string): Observable<ApiResponse<IContentPage>> {
    return this.http.get<ApiResponse<IContentPage>>(`${this.apiURL}/public/pages/${encodeURIComponent(slug)}`).pipe(timeout({ first: 8000 }));
  }

  getAdminContent(): Observable<ApiResponse<ISiteContent>> {
    return this.http.get<ApiResponse<ISiteContent>>(`${this.apiURL}/admin`).pipe(timeout({ first: 10000 }));
  }

  saveAdminContent(content: ISiteContentUpdate): Observable<ApiResponse<ISiteContent>> {
    return this.http.put<ApiResponse<ISiteContent>>(`${this.apiURL}/admin`, content).pipe(timeout({ first: 10000 }));
  }

  createPage(page: IContentPageInput): Observable<ApiResponse<IContentPage>> {
    return this.http.post<ApiResponse<IContentPage>>(`${this.apiURL}/admin/pages`, page).pipe(timeout({ first: 10000 }));
  }

  updatePage(id: string, page: Partial<IContentPageInput>): Observable<ApiResponse<IContentPage>> {
    return this.http.put<ApiResponse<IContentPage>>(`${this.apiURL}/admin/pages/${encodeURIComponent(id)}`, page).pipe(timeout({ first: 10000 }));
  }

  archivePage(id: string): Observable<ApiResponse<IContentPage>> {
    return this.http.delete<ApiResponse<IContentPage>>(`${this.apiURL}/admin/pages/${encodeURIComponent(id)}`).pipe(timeout({ first: 10000 }));
  }
}
