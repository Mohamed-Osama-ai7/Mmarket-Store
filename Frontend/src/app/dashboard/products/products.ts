import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, catchError, debounceTime, finalize, of, switchMap, takeUntil } from 'rxjs';
import { IProduct, ICategory } from '../../core/models/product.model';
import { ProductService } from '../../core/services/product.service';
import { CategoryService } from '../../core/services/category.service';
import { Pagination } from '../../core/models/api.model';

@Component({ selector: 'app-admin-products', imports: [CurrencyPipe, FormsModule], templateUrl: './products.html', styleUrl: './products.css' })
export class AdminProducts implements OnInit, OnDestroy {
  @ViewChild('productImagesInput') private imageInput?: ElementRef<HTMLInputElement>;
  products: IProduct[] = [];
  categories: ICategory[] = [];
  name = '';
  price: number | null = null;
  desc = '';
  stock: number | null = 0;
  category = '';
  brand = '';
  sku = '';
  audience: 'men' | 'women' | 'unisex' = 'unisex';
  garmentType: 'auto' | 'tops' | 'bottoms' | 'one-pieces' | 'accessories' = 'auto';
  manageVariants = false;
  variantModeLocked = false;
  variantRows: Array<{ _id?: string; size: string; color: string; sku: string; price: number | null; stock: number; isActive: boolean }> = [];
  imageFiles: File[] = [];
  editingId = '';
  currentImage = '';
  searchText = '';
  page = 1;
  readonly pageSize = 20;
  pagination: Pagination = { page: 1, pageSize: this.pageSize, totalItems: 0, totalPages: 0 };
  loading = true;
  saving = false;
  errorMessage = '';
  successMessage = '';
  private readonly searchChanges = new Subject<void>();
  private readonly destroy$ = new Subject<void>();

  constructor(private productService: ProductService, private categoryService: CategoryService, private readonly changeDetector: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.searchChanges.pipe(
      debounceTime(180),
      switchMap(() => {
        this.loading = true;
        this.errorMessage = '';
        this.changeDetector.markForCheck();
        return this.productService.getAllProducts(this.page, this.pageSize, { search: this.searchText, sort: 'newest' }).pipe(
          catchError((error) => {
            this.errorMessage = error?.error?.error || error?.error?.message || 'Could not load products.';
            this.changeDetector.markForCheck();
            return of(null);
          }),
          finalize(() => { this.loading = false; this.changeDetector.markForCheck(); }),
        );
      }),
      takeUntil(this.destroy$),
    ).subscribe((response) => {
      if (!response) { this.products = []; this.changeDetector.markForCheck(); return; }
      this.products = response.data || [];
      this.pagination = response.pagination || { page: this.page, pageSize: this.pageSize, totalItems: this.products.length, totalPages: this.products.length ? 1 : 0 };
      this.changeDetector.markForCheck();
    });
    this.categoryService.getAll().pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => { this.categories = response.data || []; this.changeDetector.markForCheck(); },
      error: () => { this.categories = []; this.changeDetector.markForCheck(); },
    });
    this.loadProducts();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.searchChanges.complete();
  }

  onSearchChange(): void { this.page = 1; this.loadProducts(); }
  changePage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.pagination.totalPages || nextPage === this.page) return;
    this.page = nextPage;
    this.loadProducts();
  }
  loadProducts(): void { this.searchChanges.next(); }
  typeofCategory(product: IProduct): string { return typeof product.category === 'string' ? '—' : product.category?.name || '—'; }

  onImagesChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.imageFiles = Array.from(input.files || []);
    this.errorMessage = this.imageFiles.length > 5 ? 'Choose up to 5 images.' : '';
  }

  edit(product: IProduct): void {
    this.editingId = product._id;
    this.name = product.name;
    this.price = product.price;
    this.desc = product.desc;
    this.stock = product.stock;
    this.category = typeof product.category === 'string' ? product.category : product.category?._id || '';
    this.brand = product.brand || '';
    this.sku = product.sku || '';
    this.audience = product.audience || 'unisex';
    this.garmentType = product.garmentType || 'auto';
    this.manageVariants = Boolean(product.variants?.length);
    this.variantModeLocked = Boolean(product.variants?.length);
    this.variantRows = (product.variants || []).map(variant => ({ _id: variant._id, size: variant.size || '', color: variant.color || '', sku: variant.sku || '', price: variant.price ?? null, stock: variant.stock, isActive: variant.isActive !== false }));
    this.currentImage = product.imgURL;
    this.imageFiles = [];
    if (this.imageInput) this.imageInput.nativeElement.value = ''; 
    this.errorMessage = '';
    this.successMessage = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  resetForm(): void {
    this.editingId = ''; this.name = ''; this.price = null; this.desc = ''; this.stock = 0;
    this.category = ''; this.brand = ''; this.sku = ''; this.audience = 'unisex'; this.garmentType = 'auto'; this.imageFiles = []; this.currentImage = '';
    if (this.imageInput) this.imageInput.nativeElement.value = '';
    this.manageVariants = false; this.variantModeLocked = false; this.variantRows = [];
  }

  toggleVariants(enabled: boolean): void {
    if (this.variantModeLocked && !enabled) { this.manageVariants = true; return; }
    this.manageVariants = enabled;
    if (enabled && !this.variantRows.length) this.addVariant(this.stock || 0, 'Standard', 'Default');
  }

  addVariant(stock = 0, size = '', color = ''): void {
    if (this.variantRows.length >= 100) { this.errorMessage = 'A product may have at most 100 options.'; return; }
    this.variantRows.push({ size, color, sku: '', price: null, stock, isActive: true });
    this.errorMessage = '';
  }

  removeVariant(index: number): void {
    const variant = this.variantRows[index];
    if (!variant) return;
    if (variant._id) { variant.isActive = false; variant.stock = 0; }
    else this.variantRows.splice(index, 1);
  }

  setVariantActive(index: number, active: boolean): void {
    const variant = this.variantRows[index];
    if (!variant) return;
    variant.isActive = active;
    if (!active) variant.stock = 0;
  }

  get variantStockTotal(): number {
    return this.variantRows.reduce((sum, variant) => sum + (variant.isActive && Number.isInteger(variant.stock) && variant.stock >= 0 ? variant.stock : 0), 0);
  }

  save(): void {
    this.errorMessage = ''; this.successMessage = '';
    if (!this.name.trim() || !this.desc.trim() || this.price === null || this.price < 0 || this.stock === null || this.stock < 0 || !Number.isInteger(this.stock) || !this.category || (!this.editingId && !this.imageFiles.length)) {
      this.errorMessage = 'Complete all required fields. New products need at least one PNG or JPEG image.'; return;
    }
    if (this.manageVariants) {
      if (!this.variantRows.length) { this.errorMessage = 'Add at least one size/color option or turn off variant management.'; return; }
      const keys = new Set<string>(); const skus = new Set<string>();
      for (const variant of this.variantRows) {
        if ((!variant.size.trim() && !variant.color.trim()) || !Number.isInteger(variant.stock) || variant.stock < 0 || (variant.price !== null && (!Number.isFinite(variant.price) || variant.price < 0)) || (variant.sku.trim() && !/^[a-z0-9._-]{1,60}$/i.test(variant.sku.trim()))) {
          this.errorMessage = 'Each option needs a size or color, a whole-number stock quantity, and a valid optional price/SKU.'; return;
        }
        const key = `${variant.size.trim().toLowerCase()}::${variant.color.trim().toLowerCase()}`;
        if (keys.has(key)) { this.errorMessage = 'Each size/color combination must be unique.'; return; }
        keys.add(key);
        const skuKey = variant.sku.trim().toUpperCase();
        if (skuKey && skus.has(skuKey)) { this.errorMessage = 'Variant SKUs must be unique within this product.'; return; }
        if (skuKey) skus.add(skuKey);
      }
      this.stock = this.variantStockTotal;
    }
    if (this.imageFiles.length > 5 || this.imageFiles.some(file => !['image/jpeg', 'image/png'].includes(file.type) || file.size > 2 * 1024 * 1024)) {
      this.errorMessage = 'Choose up to 5 PNG or JPEG images, each up to 2 MB.'; return;
    }
    if (this.sku.trim() && !/^[a-z0-9._-]{1,60}$/i.test(this.sku.trim())) { this.errorMessage = 'SKU may use letters, numbers, periods, underscores, and hyphens (maximum 60 characters).'; return; }
    const formData = new FormData();
    formData.append('name', this.name.trim());
    formData.append('price', String(this.price));
    formData.append('desc', this.desc.trim());
    formData.append('stock', String(this.stock));
    if (this.manageVariants) formData.append('variants', JSON.stringify(this.variantRows.map(variant => ({ ...variant, size: variant.size.trim(), color: variant.color.trim(), sku: variant.sku.trim(), price: variant.price === null || variant.price === undefined ? undefined : Number(variant.price) }))));
    formData.append('category', this.category);
    formData.append('brand', this.brand.trim());
    formData.append('sku', this.sku.trim());
    formData.append('audience', this.audience);
    formData.append('garmentType', this.garmentType);
    if (this.imageFiles.length) this.imageFiles.forEach((file, index) => formData.append(index === 0 ? 'img' : 'images', file));
    this.saving = true;
    const wasEditing = Boolean(this.editingId);
    const request = wasEditing ? this.productService.updateProduct(this.editingId, formData) : this.productService.createProduct(formData);
    request.subscribe({
      next: () => {
        this.saving = false;
        this.successMessage = wasEditing ? 'Product updated.' : 'Product created.';
        this.resetForm();
        this.changeDetector.markForCheck();
        this.loadProducts();
      },
      error: (error) => {
        this.saving = false;
        this.errorMessage = error?.error?.error || error?.error?.message || 'Could not save this product.';
        this.changeDetector.markForCheck();
      },
    });
  }

  remove(product: IProduct): void {
    if (!confirm(`Hide “${product.name}” from the storefront? This is a soft delete.`)) return;
    this.productService.deleteProduct(product._id).subscribe({
      next: () => { this.successMessage = 'Product hidden from the storefront. The record was retained.'; this.changeDetector.markForCheck(); this.loadProducts(); },
      error: (error) => { this.errorMessage = error?.error?.error || 'Could not deactivate this product.'; this.changeDetector.markForCheck(); },
    });
  }
}
