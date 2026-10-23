import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { IRefund } from '../../core/models/shop.model';
import { RefundService } from '../../core/services/refund.service';
import { StatusLabelPipe } from '../../shared/pipes/status-label.pipe';

@Component({ selector: 'app-admin-refunds', imports: [CurrencyPipe, DatePipe, FormsModule, StatusLabelPipe], templateUrl: './refunds.html', styleUrl: './refunds.css' })
export class AdminRefunds implements OnInit {
  refunds: IRefund[] = []; filterStatus = 'all'; loading = true; busyId = ''; errorMessage = ''; successMessage = ''; reviewNotes: Record<string, string> = {};
  constructor(private refundService: RefundService, private cdr?: ChangeDetectorRef) {}
  ngOnInit(): void { this.loadRefunds(); }
  get filteredRefunds(): IRefund[] { return this.filterStatus === 'all' ? this.refunds : this.refunds.filter((refund) => refund.status === this.filterStatus); }
  loadRefunds(): void {
    this.loading = true;
    this.refundService.getAdminRefunds().pipe(
      finalize(() => {
        this.loading = false;
        this.cdr?.markForCheck();
      })
    ).subscribe({
      next: (response) => {
        this.refunds = response.data || [];
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || error?.error?.message || 'Could not load refund requests.';
      }
    });
  }
  runAction(refund: IRefund, action: 'approve' | 'reject' | 'process' | 'complete' | 'fail'): void {
    this.errorMessage = ''; this.successMessage = '';
    const note = (this.reviewNotes[refund._id] || '').trim();
    if (action === 'complete' && !note) { this.errorMessage = 'Enter the refund confirmation reference in the note field before marking this refund completed.'; return; }
    this.busyId = refund._id;
    this.cdr?.markForCheck();
    const request = action === 'approve' || action === 'reject' ? this.refundService.review(refund._id, action, note) : action === 'process' ? this.refundService.startProcessing(refund._id) : action === 'complete' ? this.refundService.complete(refund._id, note) : this.refundService.fail(refund._id, note || 'Marked as failed by administrator');
    request.pipe(
      finalize(() => {
        this.busyId = '';
        this.cdr?.markForCheck();
      })
    ).subscribe({
      next: () => {
        this.successMessage = `Refund request ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'process' ? 'moved to processing' : action === 'complete' ? 'completed' : 'marked as failed'}.`;
        this.loadRefunds();
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || error?.error?.message || 'Could not update this refund request.';
      }
    });
  }
  typeofPayment(refund: IRefund): string { const payment = refund.payment as { _id?: string } | string; const id = typeof payment === 'string' ? payment : payment?._id || ''; return id.slice(-8).toUpperCase(); }
  orderId(refund: IRefund): string { const order = refund.order as { _id?: string } | string; return typeof order === 'string' ? order : order?._id || ''; }
}
