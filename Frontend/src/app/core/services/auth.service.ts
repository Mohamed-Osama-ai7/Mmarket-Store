import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiMessageResponse, ApiResponse } from '../models/api.model';
import { IUser } from '../models/shop.model';

interface ILoginResponse extends ApiResponse<IUser> {
  token: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiURL = environment.apiURL;
  private readonly platformId = inject(PLATFORM_ID);
  private get inBrowser(): boolean { return isPlatformBrowser(this.platformId); }
  private readonly tokenKey = 'meanL2Token';
  private readonly userKey = 'meanL2User';
  private readonly userSubject = new BehaviorSubject<IUser | null>(this.readUser());
  readonly currentUser$ = this.userSubject.asObservable();

  constructor(private http: HttpClient) {}

  get currentUser(): IUser | null {
    return this.userSubject.value;
  }

  get token(): string | null {
    if (!this.inBrowser) return null;
    try { return localStorage.getItem(this.tokenKey); } catch { return null; }
  }

  get isLoggedIn(): boolean {
    return !!this.token;
  }

  get isAdmin(): boolean {
    return this.currentUser?.role === 'admin';
  }

  login(email: string, password: string): Observable<ILoginResponse> {
    return this.http.post<ILoginResponse>(`${this.apiURL}auth/login`, { email, password }).pipe(
      tap((response) => {
        if (response.token && response.data) {
          if (this.inBrowser) { localStorage.setItem(this.tokenKey, response.token); localStorage.setItem(this.userKey, JSON.stringify(response.data)); }
          this.userSubject.next(response.data);
        }
      }),
    );
  }

  register(details: { name: string; email: string; password: string }): Observable<ApiResponse<IUser>> {
    return this.http.post<ApiResponse<IUser>>(`${this.apiURL}user`, details);
  }

  getProfile(): Observable<ApiResponse<IUser>> {
    return this.http.get<ApiResponse<IUser>>(`${this.apiURL}user/me`, { headers: this.authHeaders() }).pipe(
      tap((response) => {
        if (response.data) {
          if (this.inBrowser) localStorage.setItem(this.userKey, JSON.stringify(response.data));
          this.userSubject.next(response.data);
        }
      }),
    );
  }

  authHeaders(): HttpHeaders {
    const token = this.token;
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  logout(): void {
    const token = this.token;
    // Clear local UI/session state immediately; the captured token is used only
    // for the server request that revokes it for subsequent API/socket checks.
    this.clearSession();
    if (!token) return;
    this.http.post(`${this.apiURL}auth/logout`, {}, {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    }).subscribe({ error: () => undefined });
  }

  updateProfile(details: { name: string; email: string; phone?: string; address?: string }): Observable<ApiResponse<IUser>> {
    return this.http.patch<ApiResponse<IUser>>(`${this.apiURL}user/me`, details, { headers: this.authHeaders() }).pipe(
      tap((response) => {
        if (response.data) {
          if (this.inBrowser) localStorage.setItem(this.userKey, JSON.stringify(response.data));
          this.userSubject.next(response.data);
        }
      }),
    );
  }

  changePassword(currentPassword: string, newPassword: string): Observable<ApiMessageResponse> {
    return this.http.post<ApiMessageResponse>(`${this.apiURL}user/me/password`, { currentPassword, newPassword }, { headers: this.authHeaders() });
  }

  requestPasswordReset(email: string): Observable<ApiMessageResponse> {
    return this.http.post<ApiMessageResponse>(`${this.apiURL}auth/forgot-password`, { email: email.trim().toLowerCase() });
  }

  resetPassword(token: string, newPassword: string): Observable<ApiMessageResponse> {
    return this.http.post<ApiMessageResponse>(`${this.apiURL}auth/reset-password`, { token, newPassword });
  }


  getUsers(): Observable<ApiResponse<IUser[]>> {
    return this.http.get<ApiResponse<IUser[]>>(`${this.apiURL}user`, { headers: this.authHeaders() });
  }

  toggleUserStatus(id: string): Observable<ApiResponse<IUser>> {
    return this.http.patch<ApiResponse<IUser>>(`${this.apiURL}user/${id}/status`, {}, { headers: this.authHeaders() });
  }

  clearSession(): void {
    if (this.inBrowser) { try { localStorage.removeItem(this.tokenKey); localStorage.removeItem(this.userKey); } catch { /* Storage is optional. */ } }
    this.userSubject.next(null);
  }

  private readUser(): IUser | null {
    if (!this.inBrowser || !this.token) return null;
    try {
      const rawUser = localStorage.getItem(this.userKey);
      return rawUser ? JSON.parse(rawUser) as IUser : null;
    } catch {
      return null;
    }
  }
}
