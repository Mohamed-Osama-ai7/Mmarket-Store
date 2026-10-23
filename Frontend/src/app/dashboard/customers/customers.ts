import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { IUser } from '../../core/models/shop.model';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-admin-customers',
  imports: [DatePipe, FormsModule],
  templateUrl: './customers.html',
  styleUrl: './customers.css'
})
export class AdminCustomers implements OnInit {
  users: IUser[] = [];
  searchText = '';
  roleFilter = 'all';
  statusFilter = 'all';
  loading = true;
  errorMessage = '';
  successMessage = '';
  busyId = '';

  constructor(public auth: AuthService, private cdr?: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  get filteredUsers(): IUser[] {
    const query = this.searchText.trim().toLowerCase();
    return this.users.filter((user) => {
      const matchesSearch = !query ||
        `${user.name || ''} ${user.email || ''} ${user.phone || ''}`.toLowerCase().includes(query);
      const matchesRole = this.roleFilter === 'all' || user.role === this.roleFilter;
      const matchesStatus = this.statusFilter === 'all' ||
        (this.statusFilter === 'active' && user.isActive !== false) ||
        (this.statusFilter === 'inactive' && user.isActive === false);
      return matchesSearch && matchesRole && matchesStatus;
    });
  }

  get totalCustomers(): number {
    return this.users.filter(u => u.role === 'user').length;
  }

  get totalAdmins(): number {
    return this.users.filter(u => u.role === 'admin').length;
  }

  loadUsers(): void {
    this.loading = true;
    this.errorMessage = '';
    this.auth.getUsers().pipe(
      finalize(() => {
        this.loading = false;
        this.cdr?.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        this.users = response.data || [];
        this.cdr?.markForCheck();
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || error?.error?.message || 'Could not load customer accounts.';
        this.cdr?.markForCheck();
      }
    });
  }

  toggleStatus(user: IUser): void {
    if (this.isSelf(user)) {
      this.errorMessage = 'You cannot deactivate your own account.';
      return;
    }
    const action = user.isActive === false ? 'activate' : 'deactivate';
    if (!confirm(`Are you sure you want to ${action} ${user.name} (${user.email})?`)) {
      return;
    }

    this.busyId = user._id;
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr?.markForCheck();

    this.auth.toggleUserStatus(user._id).pipe(
      finalize(() => {
        this.busyId = '';
        this.cdr?.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        this.successMessage = `Account for ${user.email} successfully ${action}d.`;
        if (response.data) {
          const index = this.users.findIndex(u => u._id === user._id);
          if (index !== -1) {
            this.users[index] = response.data;
          }
        } else {
          this.loadUsers();
        }
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || error?.error?.message || `Failed to ${action} account.`;
      }
    });
  }

  isSelf(user: IUser): boolean {
    return !!this.auth.currentUser && this.auth.currentUser._id === user._id;
  }
}
