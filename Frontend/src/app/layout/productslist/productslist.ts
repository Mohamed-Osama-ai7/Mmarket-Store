import { AfterViewInit, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, catchError, finalize, of, switchMap, takeUntil, timer } from 'rxjs';
import { ProductService, ProductFilters } from '../../core/services/product.service';
import { CategoryService } from '../../core/services/category.service';
import { CartService } from '../../core/services/cart.service';
import { ICategory, IProduct, IProductFilterOptions } from '../../core/models/product.model';
import { Pagination } from '../../core/models/api.model';
import { ToastService } from '../../core/services/toast.service';
import { Product } from './product/product';

type FilterKey = 'search' | 'category' | 'minPrice' | 'maxPrice' | 'brand' | 'size' | 'color' | 'minRating' | 'sort';
interface ActiveFilter { key: FilterKey; label: string; }

@Component({
  selector: 'app-productslist',
  imports: [FormsModule, RouterLink, Product],
  templateUrl: './productslist.html',
  styleUrl: './productslist.css',
})
export class Productslist implements OnInit, AfterViewInit, OnDestroy {
  products: IProduct[] = [];
  categories: ICategory[] = [];
  filterOptions: IProductFilterOptions = { brands: [], sizes: [], colors: [] };
  searchText = '';
  categorySlug = '';
  brand = '';
  size = '';
  color = '';
  minPrice: number | null = null;
  maxPrice: number | null = null;
  minRating: number | null = null;
  sort: ProductFilters['sort'] = 'newest';
  page = 1;
  readonly pageSize = 12;
  filtersOpen = false;
  pagination: Pagination = { page: 1, pageSize: this.pageSize, totalItems: 0, totalPages: 0 };
  loading = true;
  optionsLoading = true;
  errorMessage = '';
  optionsError = '';
  cartMessage = '';
  cartError = '';
  quickAddBusyId = '';
  private readonly filterChanges = new Subject<boolean>();
  private readonly destroy$ = new Subject<void>();
  private viewReady = false;

  constructor(
    private productService: ProductService,
    private categoryService: CategoryService,
    private route: ActivatedRoute,
    private cartService: CartService,
    private router: Router,
    private title: Title,
    private meta: Meta,
    private toast: ToastService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.title.setTitle('Shop the collection | Mmarket');
    this.meta.updateTag({ name: 'description', content: 'Find clothing by size, colour, brand, rating, category, and price. Search and sort the collection.' });
    this.categorySlug = this.route.snapshot.queryParamMap.get('category') || '';

    this.filterChanges.pipe(
      // switchMap cancels an in-flight request immediately; only free-text input waits.
      switchMap((debounceSearch) => {
        this.loading = true;
        this.errorMessage = '';
        this.products = [];
        this.pagination = { page: this.page, pageSize: this.pageSize, totalItems: 0, totalPages: 0 };
        this.changeDetector.markForCheck();
        return (debounceSearch ? timer(180) : of(0)).pipe(switchMap(() => this.productService.getAllProducts(this.page, this.pageSize, this.filters).pipe(
          catchError((error: unknown) => {
            this.errorMessage = this.userFacingProductError(error);
            return of(null);
          }),
          finalize(() => {
            this.loading = false;
            this.refreshView();
          }),
        )));
      }),
      takeUntil(this.destroy$),
    ).subscribe((response) => {
      // Do not render results from an earlier query after a failure; the retry banner stays visible.
      if (!response) return;
      if (this.page > Math.max(1, response.pagination.totalPages)) {
        this.page = Math.max(1, response.pagination.totalPages);
        this.loading = true;
        this.loadProducts();
        return;
      }
      this.products = response.data;
      this.pagination = response.pagination;
      this.refreshView();
    });

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const nextCategory = params.get('category') || '';
      if (nextCategory !== this.categorySlug) {
        this.categorySlug = nextCategory;
        this.page = 1;
        this.loadProducts();
      }
      this.changeDetector.markForCheck();
    });
    this.categoryService.getAll().pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => { this.categories = response.data || []; this.refreshView(); },
      error: () => { this.categories = []; this.refreshView(); },
    });
    this.loadFilterOptions();
    this.loadProducts();
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
  }

  ngOnDestroy(): void {
    this.viewReady = false;
    this.destroy$.next();
    this.destroy$.complete();
    this.filterChanges.complete();
  }

  get filters(): ProductFilters {
    return { search: this.searchText, category: this.categorySlug, minPrice: this.minPrice, maxPrice: this.maxPrice,
      brand: this.brand, size: this.size, color: this.color, minRating: this.minRating, sort: this.sort };
  }

  get activeFilters(): ActiveFilter[] {
    const filters: ActiveFilter[] = [];
    if (this.searchText.trim()) filters.push({ key: 'search', label: `Search: ${this.searchText.trim()}` });
    if (this.categorySlug) filters.push({ key: 'category', label: `Category: ${this.categories.find(category => category.slug === this.categorySlug)?.name || this.categorySlug}` });
    if (this.brand) filters.push({ key: 'brand', label: `Brand: ${this.brand}` });
    if (this.size) filters.push({ key: 'size', label: `Size: ${this.size}` });
    if (this.color) filters.push({ key: 'color', label: `Colour: ${this.color}` });
    if (this.minPrice !== null && this.minPrice !== undefined) filters.push({ key: 'minPrice', label: `From ${this.minPrice} EGP` });
    if (this.maxPrice !== null && this.maxPrice !== undefined) filters.push({ key: 'maxPrice', label: `Up to ${this.maxPrice} EGP` });
    if (this.minRating !== null && this.minRating !== undefined) filters.push({ key: 'minRating', label: `${this.minRating}+ stars` });
    if (this.sort && this.sort !== 'newest') filters.push({ key: 'sort', label: `Sort: ${this.sortLabel(this.sort)}` });
    return filters;
  }

  loadFilterOptions(): void {
    this.optionsLoading = true;
    this.optionsError = '';
    this.productService.getFilterOptions().pipe(
      catchError(() => {
        this.optionsError = 'Some filter options are unavailable. You can still search and browse the collection.';
        this.refreshView();
        return of(null);
      }),
      finalize(() => {
        this.optionsLoading = false;
        this.refreshView();
      }),
      takeUntil(this.destroy$),
    ).subscribe((response) => {
      if (!response) return;
      this.filterOptions = response.data;
      this.optionsError = '';
      this.refreshView();
    });
  }

  private userFacingProductError(error: unknown): string {
    const candidate = typeof error === 'object' && error !== null
      ? (error as { error?: { error?: unknown; message?: unknown }; message?: unknown })
      : undefined;
    const apiMessage = candidate?.error?.error ?? candidate?.error?.message ?? candidate?.message;
    if (typeof apiMessage === 'string') {
      const message = apiMessage.trim();
      const looksInternal = /(?:\bstack trace\b|\bnode_modules\b|\bmongodb:\/\/|\bsecret\b|\bpassword\b|\n\s*at\s)/i.test(message);
      if (message && message.length <= 180 && !looksInternal) return message;
    }
    return 'Could not load products. Check that the backend is running, then try again.';
  }

  get hasActiveFilters(): boolean { return this.activeFilters.length > 0; }
  get filterCount(): number { return this.activeFilters.length; }
  sortLabel(sort: ProductFilters['sort']): string {
    return ({ oldest: 'Oldest first', 'price-asc': 'Price low to high', 'price-desc': 'Price high to low', 'name-asc': 'Name A–Z', newest: 'Newest first' } as const)[sort || 'newest'];
  }

  onSearchChange(): void { this.page = 1; this.loadProducts(true); }
  onFilterChange(): void { this.page = 1; this.loadProducts(); }
  onCategoryChange(): void {
    this.page = 1;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { category: this.categorySlug || null }, queryParamsHandling: 'merge', replaceUrl: true });
    this.loadProducts();
  }
  loadProducts(debounceSearch = false): void { this.filterChanges.next(debounceSearch); }

  // HTTP results arrive after the first render. Re-render this view explicitly so the list appears
  // without an unrelated event (such as typing in search) having to trigger change detection.
  private refreshView(): void {
    this.changeDetector.markForCheck();
    if (this.viewReady) this.changeDetector.detectChanges();
  }

  removeFilter(key: FilterKey): void {
    switch (key) {
      case 'search': this.searchText = ''; break;
      case 'category': this.categorySlug = ''; void this.router.navigate([], { relativeTo: this.route, queryParams: { category: null }, queryParamsHandling: 'merge', replaceUrl: true }); break;
      case 'brand': this.brand = ''; break;
      case 'size': this.size = ''; break;
      case 'color': this.color = ''; break;
      case 'minPrice': this.minPrice = null; break;
      case 'maxPrice': this.maxPrice = null; break;
      case 'minRating': this.minRating = null; break;
      case 'sort': this.sort = 'newest'; break;
    }
    this.page = 1;
    this.loadProducts();
  }

  changePage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.pagination.totalPages || nextPage === this.page) return;
    this.page = nextPage;
    this.loadProducts();
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  resetFilters(): void {
    this.searchText = '';
    this.categorySlug = '';
    this.brand = '';
    this.size = '';
    this.color = '';
    this.minPrice = null;
    this.maxPrice = null;
    this.minRating = null;
    this.sort = 'newest';
    this.page = 1;
    if (this.route.snapshot.queryParamMap.has('category')) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: { category: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
    this.loadProducts();
  }

  quickAdd(product: IProduct): void {
    if (this.quickAddBusyId) return;
    this.cartMessage = '';
    this.cartError = '';
    if (product.variants?.length) {
      void this.router.navigate(['/products', product.slug]);
      this.toast.show('info', 'Choose your size and colour to add this item.');
      return;
    }
    this.quickAddBusyId = product._id;
    this.cartService.add(product._id, 1, product).subscribe({
      next: () => { this.cartMessage = `${product.name} — Added to cart!`; this.quickAddBusyId = ''; this.toast.show('success', 'Added to cart!'); this.refreshView(); },
      error: (error) => { this.quickAddBusyId = ''; this.cartError = error?.error?.error || error?.error?.message || error?.message || 'Could not add this item to your cart.'; this.toast.show('error', this.cartError); this.refreshView(); },
    });
  }
}
