import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { RefundService } from './refund.service';

describe('RefundService admin completion contract', () => {
  let service: RefundService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isLoggedIn: true, authHeaders: () => new HttpHeaders() } },
      ],
    });
    service = TestBed.inject(RefundService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  it('sends providerRefundId when completing a refund (required by PATCH /refunds/:id/complete)', () => {
    service.complete('r1', 'COD-REF-001').subscribe();
    const request = http.expectOne((req) => req.url.endsWith('/refunds/r1/complete'));
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ providerRefundId: 'COD-REF-001' });
    request.flush({ message: 'ok', data: {} });
  });
});
