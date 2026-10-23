import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Wishlist } from './wishlist';
import { WishlistService } from '../../core/services/wishlist.service';
import { CartService } from '../../core/services/cart.service';
import { ProductService } from '../../core/services/product.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { IProduct } from '../../core/models/product.model';

describe('Wishlist Component (TestBed)', () => {
  let fixture: ComponentFixture<Wishlist>;
  let component: Wishlist;
  let mockWishlistService: {
    getAll: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    syncProducts: ReturnType<typeof vi.fn>;
  };
  let mockCartService: {
    add: ReturnType<typeof vi.fn>;
  };
  let mockProductService: {
    imageUrl: ReturnType<typeof vi.fn>;
    hasVariablePrice: ReturnType<typeof vi.fn>;
    startingPrice: ReturnType<typeof vi.fn>;
  };
  let mockToastService: {
    show: ReturnType<typeof vi.fn>;
  };
  let mockAuthService: {
    isLoggedIn: boolean;
  };

  beforeEach(async () => {
    mockWishlistService = {
      getAll: vi.fn().mockReturnValue(of({ data: { products: [], totalProducts: 0 } })),
      remove: vi.fn().mockReturnValue(of({ data: { products: [], totalProducts: 0 } })),
      syncProducts: vi.fn(),
    };

    mockCartService = {
      add: vi.fn().mockReturnValue(of({ data: {} })),
    };

    mockProductService = {
      imageUrl: vi.fn().mockReturnValue('/placeholder.svg'),
      hasVariablePrice: vi.fn().mockReturnValue(false),
      startingPrice: vi.fn().mockReturnValue(100),
    };

    mockToastService = {
      show: vi.fn(),
    };

    mockAuthService = {
      isLoggedIn: true,
    };

    await TestBed.configureTestingModule({
      imports: [Wishlist],
      providers: [
        provideRouter([]),
        { provide: WishlistService, useValue: mockWishlistService },
        { provide: CartService, useValue: mockCartService },
        { provide: ProductService, useValue: mockProductService },
        { provide: ToastService, useValue: mockToastService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Wishlist);
    component = fixture.componentInstance;
  });

  it('loads products successfully on init, terminates loading state, and renders product cards', () => {
    const mockProducts: Partial<IProduct>[] = [
      { _id: 'prod-1', name: 'Linen Shirt', slug: 'linen-shirt', price: 200, stock: 10, brand: 'Mmarket' },
      { _id: 'prod-2', name: 'Chino Pants', slug: 'chino-pants', price: 350, stock: 5, brand: 'Mmarket' },
    ];
    mockWishlistService.getAll.mockReturnValue(
      of({ data: { products: mockProducts, totalProducts: 2 } })
    );

    fixture.detectChanges(); // triggers ngOnInit -> loadWishlist()

    expect(component.loading).toBe(false);
    expect(component.products).toHaveLength(2);
    expect(component.errorMessage).toBe('');
    expect(mockWishlistService.syncProducts).toHaveBeenCalledWith(mockProducts);

    const cards = fixture.debugElement.queryAll(By.css('.wishlist-card'));
    expect(cards).toHaveLength(2);
  });

  it('handles empty wishlist by terminating loading and rendering empty state UI', () => {
    mockWishlistService.getAll.mockReturnValue(
      of({ data: { products: [], totalProducts: 0 } })
    );

    fixture.detectChanges();

    expect(component.loading).toBe(false);
    expect(component.products).toHaveLength(0);

    const emptyState = fixture.debugElement.query(By.css('.empty-state'));
    expect(emptyState).not.toBeNull();
    expect(emptyState.nativeElement.textContent).toContain('No favourites saved yet');
  });

  it('terminates loading state and renders error alert on API failure', () => {
    mockWishlistService.getAll.mockReturnValue(
      throwError(() => ({ error: { error: 'Service temporarily unavailable' } }))
    );

    fixture.detectChanges();

    expect(component.loading).toBe(false);
    expect(component.products).toHaveLength(0);
    expect(component.errorMessage).toBe('Service temporarily unavailable');

    const alert = fixture.debugElement.query(By.css('.alert-warning'));
    expect(alert).not.toBeNull();
    expect(alert.nativeElement.textContent).toContain('Service temporarily unavailable');
  });

  it('handles timeout error gracefully with a retryable message', () => {
    mockWishlistService.getAll.mockReturnValue(
      throwError(() => ({ name: 'TimeoutError' }))
    );

    fixture.detectChanges();

    expect(component.loading).toBe(false);
    expect(component.errorMessage).toContain('timed out');
  });

  it('terminates loading immediately when user is not authenticated', () => {
    mockAuthService.isLoggedIn = false;

    fixture.detectChanges();

    expect(component.loading).toBe(false);
    expect(component.products).toHaveLength(0);
    expect(component.errorMessage).toContain('sign in');
    expect(mockWishlistService.getAll).not.toHaveBeenCalled();
  });

  it('removes an item from wishlist, updates UI, and clears busyId', () => {
    const item: Partial<IProduct> = { _id: 'prod-1', name: 'Linen Shirt', slug: 'linen-shirt', price: 200, stock: 10 };
    component.products = [item as IProduct];
    mockWishlistService.remove.mockReturnValue(of({ data: {} }));

    component.remove(item as IProduct);

    expect(component.busyId).toBe('');
    expect(component.products).toHaveLength(0);
    expect(component.successMessage).toContain('Removed');
    expect(mockWishlistService.remove).toHaveBeenCalledWith('prod-1');
  });

  it('handles error when removing an item without getting stuck in busy state', () => {
    const item: Partial<IProduct> = { _id: 'prod-1', name: 'Linen Shirt', slug: 'linen-shirt', price: 200, stock: 10 };
    component.products = [item as IProduct];
    mockWishlistService.remove.mockReturnValue(
      throwError(() => ({ error: { error: 'Cannot remove item right now' } }))
    );

    component.remove(item as IProduct);

    expect(component.busyId).toBe('');
    expect(component.products).toHaveLength(1);
    expect(component.errorMessage).toBe('Cannot remove item right now');
  });

  it('adds an item to cart, triggers toast feedback, and clears busyId', () => {
    const item: Partial<IProduct> = { _id: 'prod-1', name: 'Linen Shirt', slug: 'linen-shirt', price: 200, stock: 10 };
    mockCartService.add.mockReturnValue(of({ data: {} }));

    component.addToCart(item as IProduct);

    expect(component.busyId).toBe('');
    expect(component.successMessage).toContain('Added to cart');
    expect(mockCartService.add).toHaveBeenCalledWith('prod-1', 1, item);
    expect(mockToastService.show).toHaveBeenCalledWith('success', 'Added to cart!');
  });

  it('handles error when adding an item to cart without getting stuck in busy state', () => {
    const item: Partial<IProduct> = { _id: 'prod-1', name: 'Linen Shirt', slug: 'linen-shirt', price: 200, stock: 10 };
    mockCartService.add.mockReturnValue(
      throwError(() => ({ error: { error: 'Stock insufficient' } }))
    );

    component.addToCart(item as IProduct);

    expect(component.busyId).toBe('');
    expect(component.errorMessage).toBe('Stock insufficient');
    expect(mockToastService.show).toHaveBeenCalledWith('error', 'Stock insufficient');
  });
});
