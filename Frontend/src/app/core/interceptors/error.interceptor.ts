import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const protectedRequest = request.headers.has('Authorization') || !!auth.token;
  const isLoginRequest = request.url.includes('/auth/login');

  return next(request).pipe(catchError((error: unknown) => {
    if (error instanceof HttpErrorResponse && error.status === 401 && protectedRequest && !isLoginRequest) {
      auth.clearSession();
      const returnUrl = router.url.startsWith('/') && !router.url.startsWith('//') ? router.url : '/home';
      void router.navigate(['/login'], { queryParams: { returnUrl } });
    }
    return throwError(() => error);
  }));
};
