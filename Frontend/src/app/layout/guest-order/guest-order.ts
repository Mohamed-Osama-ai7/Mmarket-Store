import { Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { CurrencyPipe, DatePipe, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IOrder } from '../../core/models/shop.model';
import { OrderService } from '../../core/services/order.service';

@Component({ selector: 'app-guest-order', imports: [CurrencyPipe, DatePipe, FormsModule, RouterLink], templateUrl: './guest-order.html', styleUrl: './guest-order.css' })
export class GuestOrder implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  order: IOrder | null = null;
  orderId = '';
  accessToken = '';
  tokenEntry = '';
  loading = false;
  saving = false;
  errorMessage = '';
  successMessage = '';
  constructor(private route: ActivatedRoute, private orderService: OrderService) {}
  get isBrowser(): boolean { return isPlatformBrowser(this.platformId); }

  ngOnInit(): void {
    this.orderId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.isBrowser || !this.orderId) return;
    try {
      this.accessToken = sessionStorage.getItem(`marketGuestOrderToken_${this.orderId}`) || '';
      const cached = sessionStorage.getItem(`marketGuestOrderSummary_${this.orderId}`);
      if (cached) this.order = JSON.parse(cached) as IOrder;
    } catch { this.accessToken = ''; this.order = null; }
    if (this.accessToken) this.loadOrder();
  }

  loadOrder(): void {
    const token = this.accessToken || this.tokenEntry.trim();
    if (!token) { this.errorMessage = 'Enter the private access code you saved after checkout.'; return; }
    this.loading = true; this.errorMessage = ''; this.successMessage = '';
    this.orderService.getGuestOrder(this.orderId, token).subscribe({
      next: ({ data }) => {
        this.order = data; this.accessToken = token; this.loading = false;
        if (this.isBrowser) { try { sessionStorage.setItem(`marketGuestOrderToken_${this.orderId}`, token); sessionStorage.setItem(`marketGuestOrderSummary_${this.orderId}`, JSON.stringify(data)); } catch { /* The page still works without session storage. */ } }
      },
      error: (error) => { this.loading = false; this.errorMessage = error?.error?.message || error?.error?.error || 'Order not found or the private access code is invalid.'; this.order = null; }
    });
  }

  cancelOrder(): void {
    if (!this.order || !this.accessToken || this.saving) return;
    if (!confirm('Cancel this order? This is only allowed while the order is still eligible.')) return;
    this.saving = true; this.errorMessage = ''; this.successMessage = '';
    this.orderService.cancelGuestOrder(this.orderId, this.accessToken).subscribe({
      next: ({ data }) => { this.order = data; this.saving = false; this.successMessage = 'The order was cancelled and eligible reserved stock was returned.'; if (this.isBrowser) { try { sessionStorage.setItem(`marketGuestOrderSummary_${this.orderId}`, JSON.stringify(data)); } catch { /* Optional. */ } } },
      error: (error) => { this.saving = false; this.errorMessage = error?.error?.message || error?.error?.error || 'The order can no longer be cancelled online.'; }
    });
  }

  canCancel(): boolean { return !!this.order && ['pending', 'confirmed'].includes(this.order.orderStatus) && this.order.paymentStatus === 'pending'; }
  itemName(item: IOrder['items'][number]): string { return item.name || (typeof item.product === 'object' ? item.product.name : 'Product'); }
}
