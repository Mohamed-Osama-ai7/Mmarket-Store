import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { ICart } from '../../core/models/shop.model';
import { CartService } from '../../core/services/cart.service';
import { ProductService } from '../../core/services/product.service';

@Component({ selector: 'app-cart', imports: [CurrencyPipe, RouterLink], templateUrl: './cart.html', styleUrl: './cart.css' })
export class Cart implements OnInit {
  cart: ICart = { items: [], totalItems: 0, totalPrice: 0 };
  loading = true; busyId = ''; message = ''; errorMessage = '';
  constructor(private cartService: CartService, public productService: ProductService, private cdr: ChangeDetectorRef) {}
  ngOnInit(): void { this.loadCart(); }
  loadCart(): void {
    this.loading = true;
    this.errorMessage = '';
    this.cartService.getCart().pipe(
      finalize(() => {
        this.loading = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        this.cart = response?.data || { items: [], totalItems: 0, totalPrice: 0 };
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || error?.error?.message || error?.message || 'Could not load your cart.';
      }
    });
  }
  get hasUnavailableItems(): boolean { return (this.cart?.items || []).some(item => item.productUnavailable || item.variantUnavailable); }
  lineKey(item: ICart['items'][number]): string { return `${item.product._id}:${item.variantId || 'default'}`; }
  stockForItem(item: ICart['items'][number]): number { return this.productService.variantFor(item.product, item.variantId)?.stock ?? item.product.stock; }
  variantLabel(item: ICart['items'][number]): string { return this.cartService.variantLabel(item); }
  linePrice(item: ICart['items'][number]): number { return this.cartService.linePrice(item); }
  changeQuantity(productId: string, quantity: number, variantId?: string): void {
    if (!Number.isInteger(quantity) || quantity < 1) return;
    const busyKey = `${productId}:${variantId || 'default'}`;
    if (this.busyId === busyKey) return;
    this.busyId = busyKey; this.errorMessage = '';
    this.cartService.update(productId, quantity, variantId).pipe(
      finalize(() => {
        this.busyId = '';
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        if (response?.data) {
          this.cart = response.data;
        }
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || error?.error?.message || error?.message || 'Could not update quantity.';
      }
    });
  }
  remove(productId: string, variantId?: string): void {
    const busyKey = `${productId}:${variantId || 'default'}`;
    if (this.busyId === busyKey) return;
    this.busyId = busyKey; this.errorMessage = '';
    this.cartService.remove(productId, variantId).pipe(
      finalize(() => {
        this.busyId = '';
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: () => {
        this.loadCart();
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || error?.message || 'Could not remove this item.';
      }
    });
  }
  clear(): void {
    this.loading = true;
    this.errorMessage = '';
    this.cartService.clear().pipe(
      finalize(() => {
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: () => this.loadCart(),
      error: (error) => {
        this.loading = false;
        this.errorMessage = error?.error?.error || error?.error?.message || error?.message || 'Could not clear the cart.';
        this.cdr.markForCheck();
      }
    });
  }
}

