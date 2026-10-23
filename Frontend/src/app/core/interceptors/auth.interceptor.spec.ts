import { HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/env';

describe('authInterceptor', () => {
  let authServiceMock: { token: string | null };

  beforeEach(() => {
    authServiceMock = { token: 'mock-jwt-token' };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authServiceMock }
      ]
    });
  });

  it('attaches Authorization Bearer token to API request', () => {
    const req = new HttpRequest('GET', `${environment.apiURL}/product`);
    let modifiedReq: HttpRequest<unknown> | null = null;
    const next: HttpHandlerFn = (request) => {
      modifiedReq = request;
      return of({} as any);
    };

    TestBed.runInInjectionContext(() => {
      authInterceptor(req, next);
    });

    expect(modifiedReq).not.toBeNull();
    expect(modifiedReq!.headers.get('Authorization')).toBe('Bearer mock-jwt-token');
  });

  it('does not overwrite existing Authorization header', () => {
    const req = new HttpRequest('GET', `${environment.apiURL}/product`, {
      headers: new HttpRequest('GET', '').headers.set('Authorization', 'Custom-Key')
    });
    let modifiedReq: HttpRequest<unknown> | null = null;
    const next: HttpHandlerFn = (request) => {
      modifiedReq = request;
      return of({} as any);
    };

    TestBed.runInInjectionContext(() => {
      authInterceptor(req, next);
    });

    expect(modifiedReq!.headers.get('Authorization')).toBe('Custom-Key');
  });

  it('does not attach header if user has no token', () => {
    authServiceMock.token = null;
    const req = new HttpRequest('GET', `${environment.apiURL}/product`);
    let modifiedReq: HttpRequest<unknown> | null = null;
    const next: HttpHandlerFn = (request) => {
      modifiedReq = request;
      return of({} as any);
    };

    TestBed.runInInjectionContext(() => {
      authInterceptor(req, next);
    });

    expect(modifiedReq!.headers.has('Authorization')).toBe(false);
  });

  it('does not attach header to external third-party requests', () => {
    const req = new HttpRequest('GET', 'https://images.unsplash.com/photo-123');
    let modifiedReq: HttpRequest<unknown> | null = null;
    const next: HttpHandlerFn = (request) => {
      modifiedReq = request;
      return of({} as any);
    };

    TestBed.runInInjectionContext(() => {
      authInterceptor(req, next);
    });

    expect(modifiedReq!.headers.has('Authorization')).toBe(false);
  });
});
