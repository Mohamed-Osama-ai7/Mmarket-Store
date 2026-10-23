import { ChangeDetectorRef, Component, OnDestroy, OnInit, PLATFORM_ID, Renderer2, inject } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { AsyncPipe, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { IProduct, IProductVariant } from '../../../core/models/product.model';
import { IReview } from '../../../core/models/shop.model';
import { ProductService } from '../../../core/services/product.service';
import { ReviewService } from '../../../core/services/review.service';
import { CartService } from '../../../core/services/cart.service';
import { WishlistService } from '../../../core/services/wishlist.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import type { ProductResolution } from '../../../core/resolvers/product.resolver';

@Component({
  selector: 'app-product-details',
  imports: [AsyncPipe, CurrencyPipe, DatePipe, DecimalPipe, RouterLink, FormsModule],
  templateUrl: './product-details.html',
  styleUrl: './product-details.css',
})
export class ProductDetails implements OnInit, OnDestroy {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private structuredDataElement: HTMLScriptElement | null = null;
  private readonly destroy$ = new Subject<void>();
  private readonly reviewChange$ = new Subject<void>();
  private readonly routeChange$ = new Subject<void>();
  wishlistBusy = false;
  product: IProduct | null = null;
  selectedImage = '';
  selectedVariantId = '';
  reviews: IReview[] = [];
  loading = true;
  quantity = 1;
  rating = 5;
  comment = '';
  busy = false;
  message = '';
  errorMessage = '';
  retryableError = false;

  constructor(private route: ActivatedRoute, public productService: ProductService, private reviewService: ReviewService, private cartService: CartService, public wishlistService: WishlistService, public auth: AuthService, private router: Router, private title: Title, private meta: Meta, private renderer: Renderer2, private toast: ToastService, private readonly changeDetector: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.route.data.pipe(takeUntil(this.destroy$)).subscribe((data) => {
      this.routeChange$.next();
      const resolution = data['product'] as ProductResolution | null;
      this.applyProduct(resolution?.product || null, resolution?.errorMessage || 'This product could not be found. It may have been removed or is no longer available.', resolution?.retryable || false);
    });
  }

  retryProduct(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug || this.loading) return;
    this.loading = true;
    this.errorMessage = '';
    this.retryableError = false;
    this.changeDetector.markForCheck();
    this.productService.getProductBySlug(slug).pipe(takeUntil(this.routeChange$), takeUntil(this.destroy$)).subscribe({
      next: response => this.applyProduct(response.data || null, response.data ? '' : 'This product is not available.', false),
      error: error => {
        const notFound = Number(error?.status || 0) === 404;
        this.applyProduct(null, notFound
          ? 'This product could not be found. It may have been removed or is no longer available.'
          : 'We could not load this product. Check your connection and try again.', !notFound);
      },
    });
  }

  private applyProduct(product: IProduct | null, errorMessage = '', retryable = false): void {
    this.product = product;
    this.selectedImage = product ? (product.images?.[0] || product.imgURL) : '';
    const initialVariant = product?.variants?.find(variant => variant.isActive !== false && variant.stock > 0) || product?.variants?.find(variant => variant.isActive !== false);
    this.selectedVariantId = initialVariant?._id || '';
    this.quantity = 1;
    this.loading = false;
    this.errorMessage = product ? '' : (errorMessage || 'This product could not be found. It may have been removed or is no longer available.');
    this.retryableError = !product && retryable;
    this.title.setTitle(product ? `${product.name} | Mmarket` : 'Product not found | Mmarket');
    this.meta.updateTag({ name: 'description', content: product ? `${product.name} — ${product.desc.replace(/\s+/g, ' ').slice(0, 155)}` : 'This product is not available.' });
    this.removeStructuredData();
    if (product) {
      this.meta.updateTag({ property: 'og:title', content: `${product.name} | Mmarket` });
      this.meta.updateTag({ property: 'og:description', content: product.desc.replace(/\s+/g, ' ').slice(0, 200) });
      this.meta.updateTag({ property: 'og:type', content: 'product' });
      this.meta.updateTag({ property: 'og:image', content: this.absoluteUrl(this.productService.imageUrl(product.imgURL)) });
      this.meta.updateTag({ property: 'og:url', content: this.absoluteUrl(`/products/${encodeURIComponent(product.slug)}`) });
      this.addStructuredData(product);
    } else {
      this.meta.updateTag({ property: 'og:title', content: 'Product not found | Mmarket' });
      this.meta.updateTag({ property: 'og:description', content: 'This product is not available.' });
      this.meta.removeTag("property='og:image'");
      this.meta.removeTag("property='og:url'");
    }
    this.reviewChange$.next();
    this.reviews = [];
    if (product) {
      this.reviewService.getProductReviews(product._id).pipe(takeUntil(this.reviewChange$), takeUntil(this.destroy$)).subscribe({
        next: (result) => { this.reviews = result.data?.reviews || []; this.changeDetector.markForCheck(); },
        error: () => { this.reviews = []; this.changeDetector.markForCheck(); },
      });
    }
    this.changeDetector.markForCheck();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); this.reviewChange$.complete(); this.routeChange$.complete(); this.removeStructuredData(); }

  private addStructuredData(product: IProduct): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const origin = this.document.location?.origin || '';
    const description = product.desc.replace(/\s+/g, ' ').slice(0, 500);
    const payload = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description,
      sku: product.sku || undefined,
      image: this.productImages(product).map((filename) => {
        const url = this.productService.imageUrl(filename);
        try { return new URL(url, origin || 'http://localhost').href; } catch { return url; }
      }),
      brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
      aggregateRating: (product.ratingCount || 0) > 0
        ? { '@type': 'AggregateRating', ratingValue: Number(product.ratingAverage || 0).toFixed(1), reviewCount: product.ratingCount }
        : undefined,
      offers: {
        '@type': 'Offer',
        priceCurrency: 'EGP',
        price: Number(this.displayPrice).toFixed(2),
        availability: this.displayStock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: `${origin}/products/${encodeURIComponent(product.slug)}`,
      },
    };
    const script = this.renderer.createElement('script') as HTMLScriptElement;
    script.type = 'application/ld+json';
    this.renderer.setProperty(script, 'textContent', JSON.stringify(payload));
    this.renderer.appendChild(this.document.head, script);
    this.structuredDataElement = script;
  }

  // Social crawlers need absolute URLs; relative media paths are resolved against the storefront origin.
  private absoluteUrl(url: string): string {
    const origin = this.document.location?.origin || 'http://localhost';
    try { return new URL(url, origin).href; } catch { return url; }
  }

  private removeStructuredData(): void {
    if (this.structuredDataElement?.parentNode) this.renderer.removeChild(this.document.head, this.structuredDataElement);
    this.structuredDataElement = null;
  }

  productImages(product: IProduct): string[] { return Array.from(new Set([...(product.images || []), product.imgURL].filter((value): value is string => Boolean(value)))).slice(0, 5); }

  selectImage(filename: string): void { this.selectedImage = filename; }

  get currentImageIndex(): number {
    if (!this.product) return 0;
    const index = this.productImages(this.product).indexOf(this.selectedImage || this.product.imgURL);
    return index < 0 ? 0 : index;
  }

  get hasMultipleImages(): boolean { return Boolean(this.product && this.productImages(this.product).length > 1); }
  get averageReviewRating(): number { return this.reviews.length ? Math.round(this.reviews.reduce((total, review) => total + review.rating, 0) / this.reviews.length * 10) / 10 : 0; }
  get reviewStars(): string { const rounded = Math.round(this.averageReviewRating); return '★'.repeat(rounded) + '☆'.repeat(5 - rounded); }

  moveImage(offset: number): void {
    if (!this.product) return;
    const images = this.productImages(this.product);
    if (images.length < 2) return;
    const nextIndex = (this.currentImageIndex + offset + images.length) % images.length;
    this.selectedImage = images[nextIndex];
  }

  typeofCategory(product: IProduct): string { return typeof product.category === 'string' ? 'The collection' : product.category?.name || 'The collection'; }

  get hasVariants(): boolean { return Boolean(this.product?.variants?.length); }
  get activeVariants(): IProductVariant[] { return (this.product?.variants || []).filter(variant => variant.isActive !== false); }
  get availableSizes(): string[] { return [...new Set(this.activeVariants.map(variant => variant.size?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); }
  get availableColors(): string[] { return [...new Set(this.activeVariants.map(variant => variant.color?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)); }
  get selectedVariant(): IProductVariant | undefined { return this.activeVariants.find(variant => variant._id === this.selectedVariantId); }
  get selectedSize(): string { return this.selectedVariant?.size || ''; }
  get selectedColor(): string { return this.selectedVariant?.color || ''; }
  sizeAvailable(size: string): boolean { return this.activeVariants.some(variant => variant.size === size && variant.stock > 0); }
  colorAvailable(color: string): boolean { return this.activeVariants.some(variant => variant.color === color && variant.stock > 0); }
  selectSize(size: string): void {
    const candidates = this.activeVariants.filter(variant => variant.size === size && variant.stock > 0);
    const variant = candidates.find(item => !this.selectedColor || item.color === this.selectedColor) || candidates[0];
    if (variant) this.setSelectedVariant(variant);
  }
  selectColor(color: string): void {
    const candidates = this.activeVariants.filter(variant => variant.color === color && variant.stock > 0);
    const variant = candidates.find(item => !this.selectedSize || item.size === this.selectedSize) || candidates[0];
    if (variant) this.setSelectedVariant(variant);
  }
  colorSwatch(color: string): string {
    const known: Record<string, string> = { black: '#232323', white: '#f7f7f3', olive: '#78815a', beige: '#d9c5a0', navy: '#243a5c', blue: '#426c9b', red: '#b5463d', brown: '#80563f', grey: '#92969a', gray: '#92969a', pink: '#d89ba9', green: '#5e8167', yellow: '#ddbf58', orange: '#d9864c', purple: '#8a6aa6' };
    return known[color.trim().toLowerCase()] || '#b7ada9';
  }
  private setSelectedVariant(variant: IProductVariant): void {
    this.selectedVariantId = variant._id;
    this.quantity = Math.min(Math.max(1, this.quantity), Math.max(1, variant.stock));
    this.errorMessage = '';
    this.removeStructuredData();
    if (this.product) this.addStructuredData(this.product);
  }
  get displayPrice(): number { return this.product ? this.productService.priceFor(this.product, this.selectedVariantId) : 0; }
  get displayStock(): number { return this.product ? (this.hasVariants ? (this.selectedVariant?.stock || 0) : this.product.stock) : 0; }
  get validQuantity(): boolean { return Number.isInteger(this.quantity) && this.quantity >= 1 && this.quantity <= 20 && this.quantity <= this.displayStock; }
  get canAddToCart(): boolean { return Boolean(this.product && this.displayStock > 0 && (!this.hasVariants || this.selectedVariant) && this.validQuantity && !this.busy); }
  get canTryOn(): boolean { return Boolean(this.product && this.product.garmentType !== 'accessories' && this.productService.hasLocalProductImage(this.product)); }
  optionLabel(variant: IProductVariant): string { return [variant.size, variant.color].filter(value => Boolean(value?.trim())).join(' · ') || 'Standard'; }
  chooseVariant(variant: IProductVariant): void { if (variant.isActive !== false && variant.stock > 0) this.setSelectedVariant(variant); }



  addToCart(): void {
    if (!this.product) return;
    this.errorMessage = ''; this.message = '';
    if (this.hasVariants && !this.selectedVariant) { this.errorMessage = 'Choose an available size/color option first.'; return; }
    if (!Number.isInteger(this.quantity) || this.quantity < 1 || this.quantity > 20) { this.errorMessage = 'Choose a whole-number quantity between 1 and 20.'; return; }
    if (this.quantity > this.displayStock) { this.errorMessage = 'The selected option does not have enough stock.'; return; }
    this.busy = true;
    this.cartService.add(this.product._id, this.quantity, this.product, this.selectedVariantId || undefined).subscribe({ next: () => { this.message = 'Added to cart!'; this.toast.show('success', 'Added to cart!'); this.busy = false; this.changeDetector.markForCheck(); }, error: (error) => { this.errorMessage = error?.error?.error || error?.error?.message || error?.message || 'Could not add this item to the cart.'; this.toast.show('error', this.errorMessage); this.busy = false; this.changeDetector.markForCheck(); } });
  }

  toggleWishlist(saved: boolean): void {
    if (!this.product || this.wishlistBusy) return;
    if (!this.auth.isLoggedIn) {
      this.toast.show('info', 'Sign in to save your favourites.');
      void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    this.wishlistBusy = true; this.errorMessage = '';
    const request = saved ? this.wishlistService.remove(this.product._id) : this.wishlistService.add(this.product._id);
    request.subscribe({
      next: () => { this.wishlistBusy = false; this.message = saved ? 'Removed from your wishlist.' : 'Saved to your wishlist.'; this.toast.show('success', this.message); this.changeDetector.markForCheck(); },
      error: (error) => { this.wishlistBusy = false; this.errorMessage = error?.error?.error || error?.error?.message || 'Could not update your wishlist.'; this.changeDetector.markForCheck(); },
    });
  }

  submitReview(): void {
    if (!this.product || !this.comment.trim()) { this.errorMessage = 'Please add a comment before submitting.'; return; }
    this.busy = true; this.message = ''; this.errorMessage = '';
    this.reviewService.create(this.product._id, this.rating, this.comment.trim()).subscribe({
      next: (response) => { this.reviews = [response.data, ...this.reviews]; this.comment = ''; this.message = 'Thanks for sharing your review.'; this.busy = false; this.changeDetector.markForCheck(); },
      error: (error) => { this.errorMessage = error?.error?.error || error?.error?.message || 'A review could not be submitted. Reviews are available after delivery.'; this.busy = false; this.changeDetector.markForCheck(); },
    });
  }
}
