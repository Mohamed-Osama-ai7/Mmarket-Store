import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { IProduct } from '../../core/models/product.model';
import { WishlistService } from '../../core/services/wishlist.service';
import { CartService } from '../../core/services/cart.service';
import { ProductService } from '../../core/services/product.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

@Component({ selector: 'app-wishlist', imports: [CurrencyPipe, RouterLink], templateUrl: './wishlist.html', styleUrl: './wishlist.css' })
export class Wishlist implements OnInit {
  products: IProduct[] = [];
  loading = true;
  errorMessage = '';
  successMessage = '';
  busyId = '';

  constructor(
    private wishlistService: WishlistService,
    private cartService: CartService,
    public productService: ProductService,
    private toast: ToastService,
    private cdr?: ChangeDetectorRef,
    private auth?: AuthService
  ) {}

  ngOnInit(): void {
    this.loadWishlist();
  }

  loadWishlist(): void {
    if (this.auth && !this.auth.isLoggedIn) {
      this.loading = false;
      this.products = [];
      this.errorMessage = 'Please sign in to view your wishlist.';
      this.cdr?.markForCheck();
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.wishlistService.getAll().pipe(
      finalize(() => {
        this.loading = false;
        this.cdr?.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        this.products = response.data?.products || [];
        this.wishlistService.syncProducts(this.products);
      },
      error: (error) => {
        this.errorMessage =
          error?.error?.error ||
          error?.error?.message ||
          (error?.name === 'TimeoutError'
            ? 'The request timed out. Please retry.'
            : 'Could not load your wishlist.');
      },
    });
  }

  remove(product: IProduct): void {
    if (this.busyId) return;
    this.busyId = product._id;
    this.errorMessage = '';
    this.successMessage = '';
    this.wishlistService.remove(product._id).pipe(
      finalize(() => {
        this.busyId = '';
        this.cdr?.markForCheck();
      })
    ).subscribe({
      next: () => {
        this.products = this.products.filter((item) => item._id !== product._id);
        this.successMessage = 'Removed from your wishlist.';
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || 'Could not remove this item.';
      },
    });
  }

  addToCart(product: IProduct): void {
    if (this.busyId) return;
    this.busyId = product._id;
    this.errorMessage = '';
    this.successMessage = '';
    this.cartService.add(product._id, 1, product).pipe(
      finalize(() => {
        this.busyId = '';
        this.cdr?.markForCheck();
      })
    ).subscribe({
      next: () => {
        this.successMessage = `${product.name} — Added to cart!`;
        this.toast.show('success', 'Added to cart!');
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || 'Could not add this item to your cart.';
        this.toast.show('error', this.errorMessage);
      },
    });
  }
}
