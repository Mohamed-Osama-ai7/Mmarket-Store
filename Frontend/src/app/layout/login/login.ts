import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  email = '';
  password = '';
  busy = false;
  errorMessage = '';

  constructor(private auth: AuthService, private router: Router, private route: ActivatedRoute, private toast: ToastService) {}

  submit(): void {
    this.errorMessage = '';
    if (!this.email.trim() || !this.password) { this.errorMessage = 'Enter your email and password.'; return; }
    this.busy = true;
    this.auth.login(this.email.trim(), this.password).subscribe({
      next: (response) => {
        this.busy = false;
        const displayName = response.data.name?.trim() || 'there';
        this.toast.show('success', `Welcome back, ${displayName}!`);
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        const destination = returnUrl?.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : (response.data.role === 'admin' ? '/dashboard/home' : '/home');
        void this.router.navigateByUrl(destination);
      },
      error: (error) => { this.errorMessage = error?.error?.error || error?.error?.message || 'Sign in failed. Check your details and try again.'; this.busy = false; },
    });
  }
}
