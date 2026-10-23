import { Component } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

function passwordByteLimit(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (typeof value !== 'string' || !value) return null;
  return new TextEncoder().encode(value).length > 72 ? { passwordBytes: true } : null;
}

function matchingPasswords(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirmation = control.get('confirmPassword')?.value;
  return password && confirmation && password !== confirmation ? { passwordMismatch: true } : null;
}

@Component({
  selector: 'app-signup',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './signup.html',
  styleUrl: './signup.css',
})
export class Signup {
  readonly signupForm = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]),
    email: new FormControl('', [Validators.required, Validators.email, Validators.maxLength(254)]),
    password: new FormControl('', [Validators.required, Validators.minLength(8), passwordByteLimit]),
    confirmPassword: new FormControl('', [Validators.required]),
  }, { validators: matchingPasswords });
  busy = false;
  errorMessage = '';
  successMessage = '';

  constructor(private auth: AuthService, private router: Router, private route: ActivatedRoute, private toast: ToastService) {}

  get fields() { return this.signupForm.controls; }

  submit(): void {
    this.errorMessage = '';
    this.successMessage = '';
    if (this.signupForm.invalid) {
      this.signupForm.markAllAsTouched();
      this.errorMessage = 'Check the highlighted fields and correct the details.';
      return;
    }
    const { name, email, password } = this.signupForm.getRawValue();
    if (!name || !email || !password) return;
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    const safeReturnUrl = returnUrl?.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/home';
    this.busy = true;
    this.auth.register({ name: cleanName, email: cleanEmail, password }).subscribe({
      next: (response) => {
        this.busy = false;
        this.successMessage = `Welcome to Mmarket, ${response.data?.name || cleanName}! Your account is ready.`;
        this.toast.show('success', this.successMessage, 5500);
        void this.router.navigate(['/login'], { queryParams: { returnUrl: safeReturnUrl } });
      },
      error: (error) => {
        this.busy = false;
        this.errorMessage = error?.error?.error || error?.error?.message || 'Your account could not be saved. Check the connection and try again.';
        this.toast.show('error', this.errorMessage);
      },
    });
  }
}
