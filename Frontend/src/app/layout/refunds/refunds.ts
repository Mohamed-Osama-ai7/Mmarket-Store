import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { finalize } from 'rxjs';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IRefund, IPayment } from '../../core/models/shop.model';
import { StatusLabelPipe } from '../../shared/pipes/status-label.pipe';
import { RefundService } from '../../core/services/refund.service';
import { PaymentService } from '../../core/services/payment.service';
import { AuthService } from '../../core/services/auth.service';

@Component({ selector: 'app-refunds', imports: [CurrencyPipe, DatePipe, FormsModule, StatusLabelPipe], templateUrl: './refunds.html', styleUrl: './refunds.css' })
export class Refunds implements OnInit {
  refunds: IRefund[] = [];
  payments: IPayment[] = [];
  selectedPayment = '';
  amount: number | null = null;
  reason = '';
  loading = true;
  busy = false;
  message = '';
  errorMessage = '';
  private requestKey = '';
  private requestFingerprint = '';

  constructor(
    private refundService: RefundService,
    private paymentService: PaymentService,
    private cdr?: ChangeDetectorRef,
    private auth?: AuthService
  ) {}

  ngOnInit(): void {
    this.loadRefunds();
  }

  loadRefunds(): void {
    if (this.auth && !this.auth.isLoggedIn) {
      this.loading = false;
      this.refunds = [];
      this.payments = [];
      this.errorMessage = 'Please sign in to view your refund requests.';
      this.cdr?.markForCheck();
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    let completed = 0;
    const done = () => {
      completed += 1;
      if (completed >= 2) {
        this.loading = false;
        this.cdr?.markForCheck();
      }
    };

    this.refundService.getMine().pipe(
      finalize(done)
    ).subscribe({
      next: (response) => {
        this.refunds = Array.isArray(response?.data) ? response.data : [];
        this.cdr?.markForCheck();
      },
      error: (error) => {
        this.errorMessage =
          error?.error?.error ||
          error?.error?.message ||
          (error?.name === 'TimeoutError'
            ? 'Loading refund history timed out. Please retry.'
            : 'Could not load refund history.');
        this.cdr?.markForCheck();
      },
    });

    this.paymentService.getMyPayments().pipe(
      finalize(done)
    ).subscribe({
      next: (response) => {
        const rawPayments = Array.isArray(response?.data) ? response.data : [];
        this.payments = rawPayments.filter((payment) =>
          ['succeeded', 'partially_refunded'].includes(payment.status)
        );
        this.cdr?.markForCheck();
      },
      error: (error) => {
        this.errorMessage =
          this.errorMessage ||
          (error?.name === 'TimeoutError'
            ? 'Loading eligible payments timed out. Please retry.'
            : 'Could not load eligible payment options. Please retry.');
        this.cdr?.markForCheck();
      },
    });
  }

  requestRefund(): void {
    if (this.busy) return;
    this.errorMessage = '';
    this.message = '';
    if (!this.selectedPayment || !this.amount || this.amount <= 0 || this.reason.trim().length < 3) {
      this.errorMessage = 'Choose a payment, enter a valid amount and explain the reason.';
      this.cdr?.markForCheck();
      return;
    }
    this.busy = true;
    this.cdr?.markForCheck();

    const cleanReason = this.reason.trim();
    const fingerprint = JSON.stringify([this.selectedPayment, Number(this.amount), cleanReason]);
    // Keep the key after an ambiguous timeout so a manual retry asks the server for the same
    // logical operation instead of creating a second refund attempt with a new key.
    if (fingerprint !== this.requestFingerprint || !this.requestKey) {
      this.requestFingerprint = fingerprint;
      this.requestKey =
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    this.refundService.request(this.selectedPayment, Number(this.amount), cleanReason, this.requestKey).pipe(
      finalize(() => {
        this.busy = false;
        this.cdr?.markForCheck();
      })
    ).subscribe({
      next: () => {
        this.message = 'Your refund request has been submitted.';
        this.selectedPayment = '';
        this.amount = null;
        this.reason = '';
        this.requestKey = '';
        this.requestFingerprint = '';
        this.loadRefunds();
      },
      error: (error) => {
        this.errorMessage =
          error?.error?.error ||
          error?.error?.message ||
          (error?.name === 'TimeoutError'
            ? 'No response was received. Your request may have reached the server; retry the same details to check it safely.'
            : 'Could not submit this refund request. Retry the same details before creating a different request.');
      },
    });
  }

  paymentLabel(payment: IPayment): string {
    const order = payment.order as { _id?: string } | string;
    const id = typeof order === 'string' ? order : order?._id || '';
    const orderTag = id ? `Order #${id.slice(-8).toUpperCase()}` : 'Order';
    return `${orderTag} · ${payment.amount} ${payment.currency || 'EGP'}`;
  }
}
