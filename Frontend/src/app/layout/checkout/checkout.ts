import { Component, OnInit, PLATFORM_ID, inject, ChangeDetectorRef } from '@angular/core';
import { CurrencyPipe, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { ICart, IOrder } from '../../core/models/shop.model';
import { CartService } from '../../core/services/cart.service';
import { OrderService } from '../../core/services/order.service';
import { PaymentService } from '../../core/services/payment.service';
import { ProductService } from '../../core/services/product.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';

@Component({ selector: 'app-checkout', imports: [CurrencyPipe, RouterLink, FormsModule], templateUrl: './checkout.html', styleUrl: './checkout.css' })
export class Checkout implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  cart: ICart = { items: [], totalItems: 0, totalPrice: 0 };
  busy = false; loading = true; cartLoadFailed = false; profileLoading = false; errorMessage = ''; successMessage = ''; pendingOrder: IOrder | null = null;
  deliveryName = ''; deliveryPhone = ''; deliveryAddress = '';
  private checkoutKey = '';
  private readonly transientKeys = new Map<string, string>();
  private readonly pendingOrderStorageKey = 'meanL2PendingPaymentOrder';
  constructor(
    private cartService: CartService,
    private orderService: OrderService,
    private paymentService: PaymentService,
    public productService: ProductService,
    public auth: AuthService,
    private router: Router,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}
  get isBrowser(): boolean { return isPlatformBrowser(this.platformId); }
  get hasUnavailableCartItems(): boolean { return (this.cart?.items || []).some(item => item.productUnavailable || item.variantUnavailable); }
  lineKey(item: ICart['items'][number]): string { return `${item.product._id}:${item.variantId || 'default'}`; }
  linePrice(item: ICart['items'][number]): number { return item.productUnavailable || item.variantUnavailable ? 0 : this.productService.priceFor(item.product, item.variantId); }
  variantLabel(item: ICart['items'][number]): string {
    const variant = this.productService.variantFor(item.product, item.variantId);
    return variant ? [variant.size, variant.color].filter(Boolean).join(' · ') : '';
  }

  ngOnInit(): void {
    this.checkoutKey = this.getOrCreateKey('meanL2CheckoutKey');
    if (this.isBrowser) {
      try {
        const pendingOrder = this.auth.isLoggedIn ? sessionStorage.getItem(this.pendingOrderStorageKey) : null;
        if (!this.auth.isLoggedIn) sessionStorage.removeItem(this.pendingOrderStorageKey);
        this.pendingOrder = pendingOrder ? JSON.parse(pendingOrder) as IOrder : null;
      } catch { this.pendingOrder = null; sessionStorage.removeItem(this.pendingOrderStorageKey); }
    }
    if (this.auth.isLoggedIn) {
      this.profileLoading = true;
      this.auth.getProfile().pipe(
        finalize(() => {
          this.profileLoading = false;
          this.cdr.markForCheck();
        })
      ).subscribe({
        next: (response) => {
          if (response?.data) {
            this.deliveryName = response.data.name || '';
            this.deliveryPhone = response.data.phone || '';
            this.deliveryAddress = response.data.address || '';
          }
        },
        error: () => {
          this.deliveryName = this.auth.currentUser?.name || '';
        },
      });
    }
    this.loadCart();
  }

  loadCart(): void {
    this.loading = true;
    this.cartLoadFailed = false;
    this.errorMessage = '';
    this.cartService.getCart().pipe(
      finalize(() => {
        this.loading = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        this.cart = response?.data || { items: [], totalItems: 0, totalPrice: 0 };
        this.cartLoadFailed = false;
        if (!this.cart.items.length && !this.pendingOrder) {
          this.errorMessage = 'Your cart is empty. Add something before checkout.';
        }
        if (this.pendingOrder && this.auth.isLoggedIn) {
          this.errorMessage = 'Your order exists, but payment setup did not finish. Retry below to complete it safely.';
        }
      },
      error: (error) => {
        this.cartLoadFailed = true;
        this.errorMessage = error?.name === 'TimeoutError'
          ? 'Loading your cart timed out. Check your connection and retry.'
          : (error?.error?.error || error?.error?.message || error?.message || 'Could not load your cart. Please retry.');
      },
    });
  }

  submit(): void {
    if (this.busy) return;
    this.errorMessage = ''; this.successMessage = '';
    if (!this.auth.isLoggedIn) {
      this.errorMessage = 'Sign up or log in to complete your order. Your cart has been kept.';
      this.toast.show('info', 'Sign up or log in to complete your order. Your cart is saved.');
      void this.router.navigate(['/signup'], { queryParams: { returnUrl: '/checkout' } });
      return;
    }
    if (this.hasUnavailableCartItems) {
      this.errorMessage = 'One or more selected options are no longer available. Return to your cart and remove them before placing an order.';
      this.cdr.markForCheck();
      return;
    }
    if (!this.cart?.items?.length && !this.pendingOrder) {
      this.errorMessage = 'Your cart is empty.';
      this.cdr.markForCheck();
      return;
    }
    if (this.deliveryName.trim().length < 2 || !/^[+()0-9 .-]{7,24}$/.test(this.deliveryPhone.trim()) || this.deliveryAddress.trim().length < 8) {
      this.errorMessage = 'Enter a valid delivery name, phone number, and address (at least 8 characters).';
      this.cdr.markForCheck();
      return;
    }
    this.busy = true;
    this.cdr.markForCheck();
    const startPayment = (order: IOrder) => {
      const paymentKey = this.getOrCreateKey(`meanL2PaymentKey_${order._id}`);
      this.paymentService.createCashOnDelivery(order._id, paymentKey).pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.markForCheck();
        })
      ).subscribe({
        next: () => {
          this.safeRemove('meanL2CheckoutKey');
          this.safeRemove(`meanL2PaymentKey_${order._id}`);
          this.safeRemove(this.pendingOrderStorageKey);
          this.cartService.refreshCart();
          this.toast.show('success', 'Your order has been placed. Cash on delivery selected.');
          void this.router.navigate(['/orders']);
        },
        error: (error) => {
          this.pendingOrder = order;
          this.safeSet(this.pendingOrderStorageKey, JSON.stringify(order));
          this.errorMessage = error?.error?.error || error?.error?.message || error?.message || 'Your order was created, but payment setup did not finish. Retry payment setup.';
        },
      });
    };
    if (this.pendingOrder) {
      startPayment(this.pendingOrder);
      return;
    }
    this.orderService.checkout(this.checkoutKey, {
      name: this.deliveryName.trim(),
      phone: this.deliveryPhone.trim(),
      address: this.deliveryAddress.trim()
    }).pipe(
      finalize(() => {
        if (!this.pendingOrder) {
          this.busy = false;
          this.cdr.markForCheck();
        }
      })
    ).subscribe({
      next: (response) => {
        this.pendingOrder = response.data;
        this.safeSet(this.pendingOrderStorageKey, JSON.stringify(response.data));
        startPayment(response.data);
      },
      error: (error) => {
        this.busy = false;
        this.errorMessage = error?.name === 'TimeoutError'
          ? 'Checkout did not return a response. Retry safely; this session will reuse the same checkout request key.'
          : (error?.error?.message || error?.error?.error || error?.message || 'Checkout could not be completed.');
        this.cdr.markForCheck();
      },
    });
  }

  private getOrCreateKey(key: string): string {
    if (!this.isBrowser) return '';
    let value = '';
    try { value = sessionStorage.getItem(key) || ''; } catch { /* Storage is optional. */ }
    // Keep a component-lifetime fallback: payment setup can be retried after an ambiguous
    // network failure, and must reuse the same idempotency key when browser storage is blocked.
    if (!value) value = this.transientKeys.get(key) || '';
    if (!value) value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.transientKeys.set(key, value);
    this.safeSet(key, value);
    return value;
  }
  private safeSet(key: string, value: string): void { if (this.isBrowser) { try { sessionStorage.setItem(key, value); } catch { /* Storage may be disabled. */ } } }
  private safeRemove(key: string): void {
    this.transientKeys.delete(key);
    if (this.isBrowser) { try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ } }
  }
}
