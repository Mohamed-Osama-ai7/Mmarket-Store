import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-reset-password',
  imports: [FormsModule, RouterLink],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.css',
})
export class ResetPassword {
  token = '';
  password = '';
  confirmPassword = '';
  busy = false;
  errorMessage = '';
  successMessage = '';

  constructor(route: ActivatedRoute, private auth: AuthService, private router: Router) {
    this.token = route.snapshot.queryParamMap.get('token') || '';
    if (!this.token) this.errorMessage = 'This reset link is incomplete. Request a new one.';
  }

  submit(): void {
    this.errorMessage = '';
    this.successMessage = '';
    if (!this.token) { this.errorMessage = 'Request a new password reset link.'; return; }
    if (this.password.length < 8 || new TextEncoder().encode(this.password).length > 72) { this.errorMessage = 'Use at least 8 characters and no more than 72 UTF-8 bytes.'; return; }
    if (this.password !== this.confirmPassword) { this.errorMessage = 'The passwords do not match.'; return; }
    this.busy = true;
    this.auth.resetPassword(this.token, this.password).subscribe({
      next: (response) => { this.busy = false; this.successMessage = response.message || 'Password changed. Please sign in again.'; this.auth.clearSession(); setTimeout(() => void this.router.navigate(['/login']), 900); },
      error: (error) => { this.busy = false; this.errorMessage = error?.error?.error || 'This reset link is invalid or expired. Request a new one.'; },
    });
  }
}
