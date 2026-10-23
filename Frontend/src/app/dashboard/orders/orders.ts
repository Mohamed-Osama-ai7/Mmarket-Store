import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { IOrder, IPayment, OrderStatus } from '../../core/models/shop.model';
import { OrderService } from '../../core/services/order.service';
import { PaymentService } from '../../core/services/payment.service';
import { StatusLabelPipe } from '../../shared/pipes/status-label.pipe';

@Component({ selector: 'app-admin-orders', imports: [CurrencyPipe, DatePipe, FormsModule, StatusLabelPipe], templateUrl: './orders.html', styleUrl: './orders.css' })
export class AdminOrders implements OnInit {
  orders: IOrder[] = []; payments: IPayment[] = []; filterStatus = 'all'; loading = true; errorMessage = ''; successMessage = ''; busyId = '';
  constructor(private orderService: OrderService, private paymentService: PaymentService, private cdr?: ChangeDetectorRef) {}
  ngOnInit(): void { this.loadData(); }
  get filteredOrders(): IOrder[] { return this.filterStatus === 'all' ? this.orders : this.orders.filter((order) => order.orderStatus === this.filterStatus); }
  loadData(): void {
    this.loading = true;
    let done = 0;
    const finish = () => {
      done++;
      if (done >= 2) {
        this.loading = false;
        this.cdr?.markForCheck();
      }
    };
    this.orderService.getAdminOrders().pipe(
      finalize(() => finish())
    ).subscribe({
      next: (response) => {
        this.orders = response.data || [];
        this.cdr?.markForCheck();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || error?.error?.error || 'Could not load orders.';
        this.cdr?.markForCheck();
      }
    });
    this.paymentService.getAdminPayments().pipe(
      finalize(() => finish())
    ).subscribe({
      next: (response) => {
        this.payments = response.data || [];
        this.cdr?.markForCheck();
      },
      error: () => {
        this.cdr?.markForCheck();
      }
    });
  }
  paymentFor(orderId: string): IPayment | undefined { return this.payments.find((payment) => { const order = payment.order as IOrder | string; return (typeof order === 'string' ? order : order?._id) === orderId; }); }
  nextStatuses(order: IOrder): OrderStatus[] { const transitions: Record<OrderStatus, OrderStatus[]> = { pending: ['confirmed', 'cancelled'], confirmed: ['processing', 'cancelled'], processing: order.paymentStatus === 'paid' ? ['completed'] : ['cancelled'], completed: [], cancelled: [] }; return transitions[order.orderStatus] || []; }
  moveToNextStatus(order: IOrder): void { const next = this.nextStatuses(order)[0]; if (next) this.updateStatus(order, next); }
  isPaymentBusy(orderId: string): boolean { const payment = this.paymentFor(orderId); return !!payment && this.busyId === payment._id; }
  updateStatus(order: IOrder, status: OrderStatus): void {
    this.errorMessage = ''; this.successMessage = ''; this.busyId = order._id;
    this.cdr?.markForCheck();
    this.orderService.updateStatus(order._id, status).pipe(
      finalize(() => {
        this.busyId = '';
        this.cdr?.markForCheck();
      })
    ).subscribe({
      next: () => {
        this.successMessage = `Order #${order._id.slice(-8).toUpperCase()} moved to ${status}.`;
        this.loadData();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || error?.error?.error || 'The order status could not be changed.';
      }
    });
  }
  confirmCash(payment: IPayment | undefined): void {
    if (!payment) return;
    if (!confirm('Confirm that the cash-on-delivery payment has been received?')) return;
    this.busyId = payment._id;
    this.cdr?.markForCheck();
    this.paymentService.confirmCashOnDelivery(payment._id).pipe(
      finalize(() => {
        this.busyId = '';
        this.cdr?.markForCheck();
      })
    ).subscribe({
      next: () => {
        this.successMessage = 'Cash-on-delivery payment confirmed.';
        this.loadData();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || error?.error?.error || 'Could not confirm COD payment.';
      }
    });
  }
  customerName(order: IOrder): string { const user = order.user as { name?: string; email?: string } | string | undefined; return typeof user === 'object' && user ? `${user.name || 'Customer'}${user.email ? ' · ' + user.email : ''}` : `${order.guestName || 'Guest customer'}${order.guestEmail ? ' · ' + order.guestEmail : ''}`; }
}
