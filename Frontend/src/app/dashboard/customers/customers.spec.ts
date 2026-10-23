import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminCustomers } from './customers';
import { AuthService } from '../../core/services/auth.service';
import { IUser } from '../../core/models/shop.model';

describe('AdminCustomers component', () => {
  let component: AdminCustomers;
  let fixture: ComponentFixture<AdminCustomers>;
  let authServiceMock: {
    currentUser: IUser | null;
    getUsers: ReturnType<typeof vi.fn>;
    toggleUserStatus: ReturnType<typeof vi.fn>;
  };

  const mockUsers: IUser[] = [
    { _id: 'u1', name: 'Alice Customer', email: 'alice@test.com', role: 'user', isActive: true },
    { _id: 'u2', name: 'Bob Admin', email: 'bob@test.com', role: 'admin', isActive: true },
    { _id: 'u3', name: 'Charlie Deactivated', email: 'charlie@test.com', role: 'user', isActive: false },
  ];

  beforeEach(async () => {
    authServiceMock = {
      currentUser: { _id: 'u2', name: 'Bob Admin', email: 'bob@test.com', role: 'admin', isActive: true },
      getUsers: vi.fn().mockReturnValue(of({ message: 'Users retrieved', data: mockUsers })),
      toggleUserStatus: vi.fn().mockReturnValue(of({ message: 'Status updated', data: { ...mockUsers[0], isActive: false } })),
    };

    await TestBed.configureTestingModule({
      imports: [AdminCustomers],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminCustomers);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('initializes and loads registered users', () => {
    expect(authServiceMock.getUsers).toHaveBeenCalled();
    expect(component.users.length).toBe(3);
    expect(component.totalCustomers).toBe(2);
    expect(component.totalAdmins).toBe(1);
  });

  it('filters users by search query and role', () => {
    component.searchText = 'alice';
    expect(component.filteredUsers.length).toBe(1);
    expect(component.filteredUsers[0].name).toBe('Alice Customer');

    component.searchText = '';
    component.roleFilter = 'admin';
    expect(component.filteredUsers.length).toBe(1);
    expect(component.filteredUsers[0].email).toBe('bob@test.com');
  });

  it('prevents deactivating self account', () => {
    component.toggleStatus(mockUsers[1]);
    expect(component.errorMessage).toContain('cannot deactivate your own account');
    expect(authServiceMock.toggleUserStatus).not.toHaveBeenCalled();
  });

  it('calls toggleUserStatus for other accounts', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.toggleStatus(mockUsers[0]);
    expect(authServiceMock.toggleUserStatus).toHaveBeenCalledWith('u1');
    expect(component.successMessage).toContain('successfully');
  });
});
