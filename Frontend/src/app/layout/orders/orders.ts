import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { IOrder } from '../../core/models/shop.model';
import { StatusLabelPipe } from '../../shared/pipes/status-label.pipe';
import { OrderService } from '../../core/services/order.service';

@Component({ selector: 'app-orders', imports: [CurrencyPipe, DatePipe, RouterLink, StatusLabelPipe], templateUrl: './orders.html', styleUrl: './orders.css' })
export class Orders implements OnInit {
  orders: IOrder[] = []; loading = true; busyOrderId = ''; errorMessage = ''; successMessage = '';
  constructor(private orderService: OrderService, private cdr: ChangeDetectorRef) {}
  ngOnInit(): void { this.loadOrders(); }
  loadOrders(): void {
    this.loading = true;
    this.errorMessage = '';
    this.orderService.getMyOrders().pipe(
      finalize(() => {
        this.loading = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        this.orders = Array.isArray(response?.data) ? response.data : [];
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || error?.error?.message || (error?.name === 'TimeoutError' ? 'The request timed out. Check your connection and retry.' : 'Could not load your orders.');
      }
    });
  }
  badgeClass(status: string): string { return `status-${status}`; }
  canCancel(order: IOrder): boolean { return ['pending', 'confirmed'].includes(order.orderStatus) && order.paymentStatus === 'pending'; }
  cancelOrder(order: IOrder): void {
    if (!this.canCancel(order) || this.busyOrderId) return;
    if (!confirm(`Cancel order #${order._id.slice(-8).toUpperCase()}? Stock will be returned to the catalogue.`)) return;
    this.errorMessage = ''; this.successMessage = ''; this.busyOrderId = order._id;
    this.orderService.cancelMyOrder(order._id).pipe(
      finalize(() => {
        this.busyOrderId = '';
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: () => {
        this.successMessage = 'Your order was cancelled successfully.';
        this.loadOrders();
      },
      error: (error) => {
        this.errorMessage = error?.name === 'TimeoutError'
          ? 'No response was received. Reload your orders to confirm the current status before trying again.'
          : (error?.error?.error || error?.error?.message || 'This order could not be cancelled.');
      },
    });
  }
}

