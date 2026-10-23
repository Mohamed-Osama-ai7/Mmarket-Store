import { Component, OnInit } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { OrderService } from '../../core/services/order.service';
import { IOrder } from '../../core/models/shop.model';
import { ToastService } from '../../core/services/toast.service';

@Component({ selector: 'app-profile', imports: [RouterLink, FormsModule, CurrencyPipe, DatePipe], templateUrl: './profile.html', styleUrl: './profile.css' })
export class Profile implements OnInit {
  loading = true; ordersLoading = true; savingProfile = false; changingPassword = false;
  errorMessage = ''; successMessage = ''; name = ''; email = ''; phone = ''; address = '';
  currentPassword = ''; newPassword = ''; confirmPassword = ''; orders: IOrder[] = [];
  constructor(public auth: AuthService, private orderService: OrderService, private toast: ToastService, private router: Router) {}

  get orderCount(): number { return this.orders.length; }
  get completedCount(): number { return this.orders.filter(order => order.orderStatus === 'completed').length; }
  get totalSpent(): number { return Number(this.orders.filter(order => order.orderStatus !== 'cancelled').reduce((sum, order) => sum + Number(order.total || 0), 0).toFixed(2)); }
  get recentOrders(): IOrder[] { return this.orders.slice(0, 3); }

  ngOnInit(): void {
    this.auth.getProfile().subscribe({
      next: (response) => { this.name = response.data.name; this.email = response.data.email; this.phone = response.data.phone || ''; this.address = response.data.address || ''; this.loading = false; },
      error: (error) => { this.errorMessage = error?.error?.error || error?.error?.message || 'Profile details could not be refreshed.'; this.loading = false; },
    });
    this.loadOrders();
  }

  loadOrders(): void {
    this.ordersLoading = true;
    this.orderService.getMyOrders().subscribe({
      next: response => { this.orders = Array.isArray(response.data) ? response.data : []; this.ordersLoading = false; },
      error: () => { this.orders = []; this.ordersLoading = false; },
    });
  }

  saveProfile(): void {
    this.errorMessage = ''; this.successMessage = '';
    if (this.name.trim().length < 2 || this.name.trim().length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim()) || this.phone.trim().length > 24 || (this.phone.trim() && !/^[+()0-9 .-]{7,24}$/.test(this.phone.trim())) || this.address.trim().length > 300) {
      this.errorMessage = 'Enter a valid name, email and phone number. Address must be 300 characters or fewer.'; return;
    }
    this.savingProfile = true;
    this.auth.updateProfile({ name: this.name.trim(), email: this.email.trim(), phone: this.phone.trim(), address: this.address.trim() }).subscribe({
      next: () => { this.savingProfile = false; this.successMessage = 'Your account details were saved.'; this.toast.show('success', 'Your profile was updated.'); },
      error: (error) => { this.savingProfile = false; this.errorMessage = error?.error?.error || error?.error?.message || 'Could not update your account details.'; this.toast.show('error', this.errorMessage); },
    });
  }

  savePassword(): void {
    this.errorMessage = ''; this.successMessage = '';
    if (!this.currentPassword || this.newPassword.length < 8 || new TextEncoder().encode(this.newPassword).length > 72 || this.newPassword !== this.confirmPassword) {
      this.errorMessage = 'Enter your current password, use a new password of at least 8 characters (maximum 72 UTF-8 bytes), and confirm it correctly.'; return;
    }
    this.changingPassword = true;
    this.auth.changePassword(this.currentPassword, this.newPassword).subscribe({
      next: () => { this.changingPassword = false; this.auth.clearSession(); this.toast.show('success', 'Password changed. Please log in again.'); this.successMessage = 'Password changed successfully. Sign in again with your new password.'; this.currentPassword = ''; this.newPassword = ''; this.confirmPassword = ''; void this.router.navigate(['/login']); },
      error: (error) => { this.changingPassword = false; this.errorMessage = error?.error?.error || error?.error?.message || 'Could not change your password.'; },
    });
  }
}
