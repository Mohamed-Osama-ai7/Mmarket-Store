import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { ProductService } from '../../core/services/product.service';
import { CategoryService } from '../../core/services/category.service';
import { IProduct, ICategory } from '../../core/models/product.model';
import { Product } from '../productslist/product/product';
import { CartService } from '../../core/services/cart.service';
import { ToastService } from '../../core/services/toast.service';
import { SiteContentService } from '../../core/services/site-content.service';
import { ISiteContent } from '../../core/models/site-content.model';

@Component({
  selector: 'app-home',
  imports: [RouterLink, Product],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit {
  products: IProduct[] = [];
  allProducts: IProduct[] = [];
  categories: ICategory[] = [];
  featuredProduct: IProduct | null = null;
  featuredImage = '/product-placeholder.svg';
  loading = true;
  errorMessage = '';
  cartMessage = '';
  cartError = '';
  siteContent: ISiteContent | null = null;

  constructor(
    private productService: ProductService,
    private categoryService: CategoryService,
    private cartService: CartService,
    private title: Title,
    private meta: Meta,
    private router: Router,
    private toast: ToastService,
    private siteContentService: SiteContentService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.title.setTitle('Mmarket | The everyday wardrobe');
    this.meta.updateTag({
      name: 'description',
      content: 'Discover everyday clothing, browse by collection, find your fit, and shop with cash on delivery.',
    });

    this.loadCatalogue();

    this.siteContentService.getPublicContent().subscribe({
      next: response => {
        this.siteContent = response.data;
        const storeName = response.data.brand?.storeName || 'Mmarket';
        this.title.setTitle(response.data.brand?.seoTitle || `${storeName} | The everyday wardrobe`);
        this.meta.updateTag({ name: 'description', content: response.data.brand?.seoDescription || response.data.brand?.tagline || 'Discover the latest pieces in the Mmarket collection.' });
        this.changeDetector.markForCheck();
      },
      // Existing storefront copy remains a safe fallback if CMS content is temporarily unavailable.
      error: () => { this.siteContent = null; this.changeDetector.markForCheck(); },
    });

    this.categoryService.getAll().subscribe({
      next: (response) => { this.categories = response.data || []; this.changeDetector.markForCheck(); },
      error: () => { this.categories = []; this.changeDetector.markForCheck(); },
    });
  }


  private loadCatalogue(): void {
    this.loading = true;
    this.errorMessage = '';
    // Read products from MongoDB through our own API. Docker seeds the starter
    // catalogue before starting the frontend. ProductService adds a request timeout.
    this.productService.getAllProducts(1, 24).subscribe({
      next: (response) => {
        const catalogue = Array.isArray(response?.data) ? response.data : [];
        this.allProducts = catalogue;
        this.products = catalogue.slice(0, 8);
        this.featuredProduct =
          catalogue.find((product) => product.garmentType === 'one-pieces') ||
          catalogue.find((product) => product.audience === 'women' && product.garmentType !== 'accessories') ||
          catalogue.find((product) => product.garmentType !== 'accessories') ||
          catalogue[0] ||
          null;
        this.featuredImage = this.featuredProduct
          ? this.productService.imageUrl(this.featuredProduct.imgURL)
          : '/product-placeholder.svg';
        this.loading = false;
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.errorMessage = 'We could not reach the product catalogue. Make sure the backend and MongoDB are running, then try again.';
        this.loading = false;
        this.changeDetector.markForCheck();
      },
    });
  }

  retryCatalogue(): void {
    this.loadCatalogue();
  }

  categoryImage(category: ICategory): string {
    const matchingProduct =
      this.allProducts.find(
        (product) => typeof product.category !== 'string' && product.category?.slug === category.slug,
      ) || this.allProducts.find((product) => product.audience === category.slug);
    return matchingProduct ? this.productService.imageUrl(matchingProduct.imgURL) : '/product-placeholder.svg';
  }

  onProductImageError(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (image && !image.src.endsWith('/product-placeholder.svg')) image.src = '/product-placeholder.svg';
  }

  trustTitle(index: number, fallback: string): string {
    return this.siteContent?.homepage?.trustItems?.[index]?.title?.trim() || fallback;
  }

  trustDescription(index: number, fallback: string): string {
    return this.siteContent?.homepage?.trustItems?.[index]?.description?.trim() || fallback;
  }

  quickAdd(product: IProduct): void {
    this.cartMessage = '';
    this.cartError = '';
    if (product.variants?.length) {
      void this.router.navigate(['/products', product.slug]);
      this.toast.show('info', 'Choose your size and colour to add this item.');
      return;
    }
    this.cartService.add(product._id, 1, product).subscribe({
      next: () => { this.cartMessage = `Added to cart: ${product.name}.`; this.toast.show('success', 'Added to cart!'); this.changeDetector.markForCheck(); },
      error: (error) => {
        this.cartError = error?.error?.error || error?.error?.message || 'Unable to add this item to your cart. Please try again.';
        this.toast.show('error', this.cartError);
        this.changeDetector.markForCheck();
      },
    });
  }
}
