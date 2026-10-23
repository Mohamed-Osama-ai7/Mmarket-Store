import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';
import { authGuard, adminGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

describe('Auth Guards', () => {
  let authServiceMock: { isLoggedIn: boolean; isAdmin: boolean };
  let router: Router;

  beforeEach(() => {
    authServiceMock = { isLoggedIn: false, isAdmin: false };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        {
          provide: Router,
          useValue: {
            createUrlTree: (commands: any[], extras?: any) => ({ commands, extras } as unknown as UrlTree)
          }
        }
      ]
    });

    router = TestBed.inject(Router);
  });

  describe('authGuard', () => {
    it('allows navigation when user is logged in', () => {
      authServiceMock.isLoggedIn = true;
      const result = TestBed.runInInjectionContext(() =>
        authGuard({} as ActivatedRouteSnapshot, { url: '/orders' } as RouterStateSnapshot)
      );
      expect(result).toBe(true);
    });

    it('redirects to /login with returnUrl when user is not logged in', () => {
      authServiceMock.isLoggedIn = false;
      const result = TestBed.runInInjectionContext(() =>
        authGuard({} as ActivatedRouteSnapshot, { url: '/orders' } as RouterStateSnapshot)
      ) as unknown as { commands: string[]; extras: { queryParams: { returnUrl: string } } };

      expect(result.commands).toEqual(['/login']);
      expect(result.extras.queryParams.returnUrl).toBe('/orders');
    });
  });

  describe('adminGuard', () => {
    it('allows navigation when user is logged in and is admin', () => {
      authServiceMock.isLoggedIn = true;
      authServiceMock.isAdmin = true;
      const result = TestBed.runInInjectionContext(() =>
        adminGuard({} as ActivatedRouteSnapshot, { url: '/dashboard' } as RouterStateSnapshot)
      );
      expect(result).toBe(true);
    });

    it('redirects to /home when user is logged in but not admin', () => {
      authServiceMock.isLoggedIn = true;
      authServiceMock.isAdmin = false;
      const result = TestBed.runInInjectionContext(() =>
        adminGuard({} as ActivatedRouteSnapshot, { url: '/dashboard' } as RouterStateSnapshot)
      ) as unknown as { commands: string[] };

      expect(result.commands).toEqual(['/home']);
    });

    it('redirects to /login when user is not logged in', () => {
      authServiceMock.isLoggedIn = false;
      authServiceMock.isAdmin = false;
      const result = TestBed.runInInjectionContext(() =>
        adminGuard({} as ActivatedRouteSnapshot, { url: '/dashboard' } as RouterStateSnapshot)
      ) as unknown as { commands: string[] };

      expect(result.commands).toEqual(['/login']);
    });
  });
});
