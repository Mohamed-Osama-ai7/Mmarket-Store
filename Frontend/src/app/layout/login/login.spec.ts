import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { Login } from './login';

function setup(loginResult: Observable<unknown>) {
  const navigateByUrl = vi.fn().mockResolvedValue(true);
  const login = vi.fn().mockReturnValue(loginResult);
  TestBed.configureTestingModule({
    imports: [Login],
    providers: [
      { provide: AuthService, useValue: { login } },
      { provide: Router, useValue: { navigateByUrl, createUrlTree: vi.fn(), serializeUrl: vi.fn(), events: of() } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
    ],
  });
  const toast = TestBed.inject(ToastService);
  const show = vi.spyOn(toast, 'show');
  const component = TestBed.createComponent(Login).componentInstance;
  component.email = ' customer@example.com ';
  component.password = 'Secret123!';
  return { component, show, login, navigateByUrl };
}

describe('Login welcome toast', () => {
  it('greets the authenticated user by their real name after a successful login', () => {
    const { component, show, login, navigateByUrl } = setup(
      of({ token: 't', data: { name: '  Mona Hassan ', role: 'customer' } }),
    );
    component.submit();
    expect(login).toHaveBeenCalledWith('customer@example.com', 'Secret123!');
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith('success', 'Welcome back, Mona Hassan!');
    expect(navigateByUrl).toHaveBeenCalledWith('/home');
  });

  it('sends administrators to the dashboard and still uses their real name', () => {
    const { component, show, navigateByUrl } = setup(of({ token: 't', data: { name: 'Admin Sara', role: 'admin' } }));
    component.submit();
    expect(show).toHaveBeenCalledWith('success', 'Welcome back, Admin Sara!');
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard/home');
  });

  it('does not show a welcome toast when login fails', () => {
    const { component, show, navigateByUrl } = setup(
      throwError(() => ({ error: { error: 'Invalid email or password' } })),
    );
    component.submit();
    expect(show).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(component.errorMessage).toBe('Invalid email or password');
    expect(component.busy).toBe(false);
  });

  it('does not call the API or show a toast when fields are empty', () => {
    const { component, show, login } = setup(of({}));
    component.email = '';
    component.submit();
    expect(login).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });
});
