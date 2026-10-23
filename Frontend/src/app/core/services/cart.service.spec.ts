import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { CartService } from './cart.service';
import { IProduct } from '../models/product.model';

describe('CartService signals', () => {
  let service: CartService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isLoggedIn: false, authHeaders: vi.fn() } },
      ],
    });
    service = TestBed.inject(CartService);
  });

  afterEach(() => { localStorage.clear(); TestBed.resetTestingModule(); });

  it('starts empty and derives count and total from the cart stream', () => {
    expect(service.cartCount()).toBe(0);
    expect(service.cartTotal()).toBe(0);

    const product = { _id: 'p1', name: 'Tee', slug: 'tee', price: 250, stock: 10 } as IProduct;
    service.add('p1', 2, product).subscribe();

    expect(service.cartCount()).toBe(2);
    expect(service.cart()?.items.length).toBe(1);
    expect(service.cartTotal()).toBeGreaterThan(0);
  });
});
