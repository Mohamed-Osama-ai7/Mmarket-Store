import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Refunds } from './refunds';
import { RefundService } from '../../core/services/refund.service';
import { PaymentService } from '../../core/services/payment.service';
import { AuthService } from '../../core/services/auth.service';
import { IPayment, IRefund } from '../../core/models/shop.model';

describe('Refunds Component (TestBed)', () => {
  let fixture: ComponentFixture<Refunds>;
  let component: Refunds;
  let mockRefundService: {
    getMine: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
  };
  let mockPaymentService: {
    getMyPayments: ReturnType<typeof vi.fn>;
  };
  let mockAuthService: {
    isLoggedIn: boolean;
  };

  beforeEach(async () => {
    mockRefundService = {
      getMine: vi.fn().mockReturnValue(of({ data: [] })),
      request: vi.fn().mockReturnValue(of({ data: { _id: 'ref-default' } })),
    };

    mockPaymentService = {
      getMyPayments: vi.fn().mockReturnValue(of({ data: [] })),
    };

    mockAuthService = {
      isLoggedIn: true,
    };

    await TestBed.configureTestingModule({
      imports: [Refunds],
      providers: [
        { provide: RefundService, useValue: mockRefundService },
        { provide: PaymentService, useValue: mockPaymentService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Refunds);
    component = fixture.componentInstance;
  });

  describe('Loading states and eligible payment filtering', () => {
    it('completes loading, filters eligible payments (succeeded / partially_refunded), and renders history', () => {
      const mockPayments: Partial<IPayment>[] = [
        { _id: 'pay-1', status: 'succeeded', amount: 100, currency: 'EGP', order: 'ord-12345678' },
        { _id: 'pay-2', status: 'pending', amount: 50, currency: 'EGP', order: 'ord-87654321' },
        { _id: 'pay-3', status: 'partially_refunded', amount: 200, currency: 'EGP', order: { _id: 'ord-11223344' } as any },
        { _id: 'pay-4', status: 'failed', amount: 75, currency: 'EGP', order: 'ord-99887766' },
      ];
      const mockRefunds: Partial<IRefund>[] = [
        { _id: 'ref-1', status: 'pending', amount: 50, reason: 'Wrong item size received' },
      ];

      mockRefundService.getMine.mockReturnValue(of({ data: mockRefunds }));
      mockPaymentService.getMyPayments.mockReturnValue(of({ data: mockPayments }));

      fixture.detectChanges(); // triggers ngOnInit -> loadRefunds()

      expect(component.loading).toBe(false);
      expect(component.refunds).toHaveLength(1);
      expect(component.payments).toHaveLength(2);
      expect(component.payments.map((p) => p._id)).toEqual(['pay-1', 'pay-3']);

      // DOM check
      const refundCards = fixture.debugElement.queryAll(By.css('.refund-card'));
      expect(refundCards).toHaveLength(1);
      expect(refundCards[0].nativeElement.textContent).toContain('Wrong item size received');

      const options = fixture.debugElement.queryAll(By.css('select option'));
      // 1 placeholder option + 2 eligible payment options = 3 options
      expect(options).toHaveLength(3);
    });

    it('terminates loading and sets errorMessage when refund history fails', () => {
      mockRefundService.getMine.mockReturnValue(throwError(() => ({ name: 'TimeoutError' })));
      mockPaymentService.getMyPayments.mockReturnValue(of({ data: [] }));

      fixture.detectChanges();

      expect(component.loading).toBe(false);
      expect(component.errorMessage).toContain('timed out');

      const alert = fixture.debugElement.query(By.css('.alert-warning'));
      expect(alert).not.toBeNull();
    });

    it('terminates loading and sets errorMessage when loading payments fails', () => {
      mockRefundService.getMine.mockReturnValue(of({ data: [] }));
      mockPaymentService.getMyPayments.mockReturnValue(throwError(() => new Error('Network error')));

      fixture.detectChanges();

      expect(component.loading).toBe(false);
      expect(component.errorMessage).toContain('eligible payment');
    });

    it('terminates loading immediately when user is not logged in', () => {
      mockAuthService.isLoggedIn = false;

      fixture.detectChanges();

      expect(component.loading).toBe(false);
      expect(component.errorMessage).toContain('sign in');
      expect(mockRefundService.getMine).not.toHaveBeenCalled();
      expect(mockPaymentService.getMyPayments).not.toHaveBeenCalled();
    });

    it('formats payment labels correctly for string orders and object orders', () => {
      const labelString = component.paymentLabel({
        _id: 'p1',
        order: '6ad9cf44169e6eee29430458',
        amount: 150,
        currency: 'EGP',
      } as any);
      expect(labelString).toBe('Order #29430458 · 150 EGP');

      const labelObject = component.paymentLabel({
        _id: 'p2',
        order: { _id: '6ad9cf44169e6eee29430999' } as any,
        amount: 300,
        currency: 'EGP',
      } as any);
      expect(labelObject).toBe('Order #29430999 · 300 EGP');
    });
  });

  describe('Form validation and submission', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('rejects submission when required fields are missing or invalid', () => {
      // 1. Missing payment
      component.selectedPayment = '';
      component.amount = 50;
      component.reason = 'Item damaged';
      component.requestRefund();
      expect(component.errorMessage).toContain('Choose a payment');
      expect(mockRefundService.request).not.toHaveBeenCalled();

      // 2. Invalid zero or negative amount
      component.selectedPayment = 'pay-1';
      component.amount = 0;
      component.requestRefund();
      expect(component.errorMessage).toContain('valid amount');
      expect(mockRefundService.request).not.toHaveBeenCalled();

      // 3. Short reason (< 3 chars)
      component.amount = 50;
      component.reason = 'no';
      component.requestRefund();
      expect(component.errorMessage).toContain('explain the reason');
      expect(mockRefundService.request).not.toHaveBeenCalled();
    });

    it('reuses the same idempotency key when retrying the same request after an ambiguous failure', () => {
      component.selectedPayment = 'pay-1';
      component.amount = 50;
      component.reason = 'Item arrived damaged';

      mockRefundService.request
        .mockReturnValueOnce(throwError(() => ({ name: 'TimeoutError' })))
        .mockReturnValueOnce(of({ data: { _id: 'refund-1' } }));

      // First attempt - fails with timeout
      component.requestRefund();
      expect(component.busy).toBe(false);
      expect(component.errorMessage).toContain('same details');
      const firstKey = mockRefundService.request.mock.calls[0][3];
      expect(firstKey).toBeTruthy();

      // Second attempt with same details
      component.requestRefund();
      const secondKey = mockRefundService.request.mock.calls[1][3];
      expect(secondKey).toBe(firstKey);
      expect(component.message).toContain('submitted');
    });

    it('generates a new idempotency key when refund request details change', () => {
      component.selectedPayment = 'pay-1';
      component.amount = 50;
      component.reason = 'Initial reason';

      mockRefundService.request
        .mockReturnValueOnce(throwError(() => new Error('temporary failure')))
        .mockReturnValueOnce(throwError(() => new Error('temporary failure')));

      component.requestRefund();
      const firstKey = mockRefundService.request.mock.calls[0][3];

      // Change amount
      component.amount = 75;
      component.requestRefund();
      const secondKey = mockRefundService.request.mock.calls[1][3];

      expect(firstKey).toBeTruthy();
      expect(secondKey).toBeTruthy();
      expect(secondKey).not.toBe(firstKey);
    });

    it('handles API failure response cleanly without getting stuck in busy state', () => {
      component.selectedPayment = 'pay-1';
      component.amount = 50;
      component.reason = 'Valid refund request reason';

      mockRefundService.request.mockReturnValue(
        throwError(() => ({ error: { error: 'Payment is not eligible for refund.' } }))
      );

      component.requestRefund();

      expect(component.busy).toBe(false);
      expect(component.errorMessage).toBe('Payment is not eligible for refund.');
    });
  });
});
