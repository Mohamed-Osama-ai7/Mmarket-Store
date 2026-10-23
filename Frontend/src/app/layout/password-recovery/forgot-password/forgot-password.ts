import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-forgot-password',
  imports: [FormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.css',
})
export class ForgotPassword {
  email = '';
  busy = false;
  errorMessage = '';
  successMessage = '';

  constructor(private auth: AuthService) {}

  submit(): void {
    this.errorMessage = '';
    this.successMessage = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
      this.errorMessage = 'Enter a valid email address.';
      return;
    }
    this.busy = true;
    this.auth.requestPasswordReset(this.email).subscribe({
      next: (response) => { this.successMessage = response.message || 'If an active account matches that email, a reset link will be sent shortly.'; this.busy = false; },
      error: () => { this.successMessage = 'If an active account matches that email, a reset link will be sent shortly.'; this.busy = false; },
    });
  }
}
