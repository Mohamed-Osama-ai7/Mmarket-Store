import { Component, OnDestroy, OnInit } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, switchMap, take, takeUntil, takeWhile, timer } from 'rxjs';
import { IProduct } from '../../core/models/product.model';
import { ProductService } from '../../core/services/product.service';
import { TryOnService } from '../../core/services/try-on.service';

@Component({ selector: 'app-try-on', imports: [CurrencyPipe, RouterLink], templateUrl: './try-on.html', styleUrl: './try-on.css' })
export class TryOn implements OnInit, OnDestroy {
  product: IProduct | null = null;
  audience: 'male' | 'female' = 'male';
  style: 'studio' | 'minimal' | 'streetwear' = 'studio';
  generatedImage = '';
  loadingProduct = true;
  generating = false;
  providerConfigured = true;
  errorMessage = '';
  statusMessage = 'Select a model and look, then generate a preview.';
  private readonly destroy$ = new Subject<void>();

  constructor(private route: ActivatedRoute, public products: ProductService, private tryOn: TryOnService) {}

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const slug = params.get('slug');
      if (!slug) { this.loadingProduct = false; this.errorMessage = 'Product not found.'; return; }
      this.products.getProductBySlug(slug).pipe(takeUntil(this.destroy$)).subscribe({
        next: (response) => {
          this.product = response.data;
          this.loadingProduct = false;
          this.audience = response.data.audience === 'women' ? 'female' : 'male';
          if (response.data.garmentType === 'accessories') this.errorMessage = 'Virtual fitting is designed for clothing, not accessories.';
          else if (!this.products.hasLocalProductImage(response.data)) this.errorMessage = 'This sample product uses a remote catalogue image. Virtual fitting requires a product image uploaded and stored locally by the administrator.';
        },
        error: () => { this.loadingProduct = false; this.errorMessage = 'We could not load this product. It may no longer be available.'; }
      });
    });
  }

  generate(): void {
    if (!this.product || this.generating || this.product.garmentType === 'accessories') return;
    if (!this.products.hasLocalProductImage(this.product)) { this.errorMessage = 'Virtual fitting requires a product image uploaded and stored locally by the administrator.'; return; }
    this.generating = true; this.errorMessage = ''; this.generatedImage = '';
    this.statusMessage = 'Preparing your product image securely…';
    this.tryOn.create(this.product.slug, this.audience, this.style).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ data }) => {
        this.statusMessage = 'Creating your model preview. This can take a short while…';
        let receivedImage = false;
        timer(0, 1800).pipe(
          switchMap(() => this.tryOn.status(data.predictionId)),
          takeWhile((result) => result.data.status !== 'completed', true),
          take(34),
          takeUntil(this.destroy$),
        ).subscribe({
          next: (result) => {
            this.statusMessage = this.statusFor(result.data.status);
            if (result.data.status === 'completed' && result.data.image) {
              this.generatedImage = result.data.image; receivedImage = true; this.generating = false;
              this.statusMessage = 'Preview ready. This is a visual estimate, not a guaranteed fit or size recommendation.';
            }
          },
          error: (error) => {
            this.generating = false;
            const message = error?.error?.error || error?.error?.message || 'The preview could not be generated right now.';
            this.errorMessage = message;
            if (/FASHN_API_KEY|not configured/i.test(message)) this.providerConfigured = false;
            this.statusMessage = 'Preview unavailable';
          },
          complete: () => {
            if (!receivedImage && this.generating) {
              this.generating = false;
              this.errorMessage = 'The model is taking longer than expected. Please try again in a moment.';
              this.statusMessage = 'Generation timed out';
            }
          }
        });
      },
      error: (error) => {
        this.generating = false;
        this.errorMessage = error?.error?.error || error?.error?.message || 'Virtual fitting could not start. Please try again.';
        if (/FASHN_API_KEY|not configured/i.test(this.errorMessage)) this.providerConfigured = false;
        this.statusMessage = 'Preview unavailable';
      }
    });
  }

  private statusFor(status: string): string {
    const labels: Record<string, string> = { starting: 'Starting the fashion model…', in_queue: 'Your preview is in the generation queue…', processing: 'The garment is being placed on the model…', completed: 'Preview ready', failed: 'Generation failed' };
    return labels[status] || 'Preparing preview…';
  }

  get placeholderImage(): string { return this.product ? this.products.imageUrl(this.product.imgURL) : '/product-placeholder.svg'; }
  get canGenerate(): boolean { return Boolean(this.product && this.product.garmentType !== 'accessories' && this.products.hasLocalProductImage(this.product)); }
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
