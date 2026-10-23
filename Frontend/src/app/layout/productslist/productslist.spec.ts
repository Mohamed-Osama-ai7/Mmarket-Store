import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ProductService } from '../../core/services/product.service';
import { CategoryService } from '../../core/services/category.service';
import { CartService } from '../../core/services/cart.service';
import { ToastService } from '../../core/services/toast.service';
import { IProduct } from '../../core/models/product.model';
import { Productslist } from './productslist';

const product: IProduct = {
  _id: 'product-1',
  name: 'Linen Shirt',
  slug: 'linen-shirt',
  price: 450,
  desc: 'A lightweight shirt.',
  stock: 8,
  imgURL: 'linen-shirt.jpg',
  category: { _id: 'category-1', name: 'Tops', slug: 'tops' },
  variants: [],
};

const listResponse = (data: IProduct[] = [product], page = 1, totalItems = data.length) => ({
  message: 'Products list',
  data,
  pagination: { page, pageSize: 12, totalItems, totalPages: Math.ceil(totalItems / 12) },
});

function setup(optionsResult = of({ data: { brands: ['Northline'], sizes: ['M'], colors: ['Olive'] } })) {
  const productService = {
    getAllProducts: vi.fn().mockReturnValue(of(listResponse())),
    getFilterOptions: vi.fn().mockReturnValue(optionsResult),
  } as unknown as ProductService;
  const categoryService = { getAll: vi.fn().mockReturnValue(of({ data: [] })) } as unknown as CategoryService;
  const route = {
    snapshot: { queryParamMap: convertToParamMap({}) },
    queryParamMap: of(convertToParamMap({})),
  } as unknown as ActivatedRoute;
  const cartService = { add: vi.fn().mockReturnValue(of({})) } as unknown as CartService;
  const router = { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router;
  const title = { setTitle: vi.fn() } as never;
  const meta = { updateTag: vi.fn() } as never;
  const toast = { show: vi.fn() } as unknown as ToastService;
  const changeDetector = { markForCheck: vi.fn(), detectChanges: vi.fn() };
  const component = new Productslist(productService, categoryService, route, cartService, router, title, meta, toast, changeDetector as never);
  return { component, productService, changeDetector };
}

function completeDebouncedRequest(): void {
  vi.advanceTimersByTime(181);
}

describe('Productslist catalogue state', () => {
  let component: Productslist | undefined;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    component?.ngOnDestroy();
    component = undefined;
    vi.useRealTimers();
  });

  it('renders results that arrive after the first render without any keystroke', () => {
    const setupResult = setup();
    component = setupResult.component;
    component.ngOnInit();
    component.ngAfterViewInit();
    setupResult.changeDetector.detectChanges.mockClear();
    component.loadProducts();

    expect(component.products).toEqual([product]);
    expect(setupResult.changeDetector.detectChanges).toHaveBeenCalled();
  });

  it('accepts successful product data into component state and stops loading', () => {
    const setupResult = setup();
    component = setupResult.component;
    component.ngOnInit();
    completeDebouncedRequest();

    expect(component.products).toEqual([product]);
    expect(component.pagination.totalItems).toBe(1);
    expect(component.loading).toBe(false);
    expect(component.errorMessage).toBe('');
    expect(component.filterOptions.brands).toEqual(['Northline']);
    expect(component.optionsLoading).toBe(false);
    expect(setupResult.changeDetector.markForCheck).toHaveBeenCalled();
  });

  it('keeps catalogue browsing available when filter options fail', () => {
    const setupResult = setup(throwError(() => new Error('filter service unavailable')));
    component = setupResult.component;
    component.ngOnInit();
    completeDebouncedRequest();

    expect(component.products).toEqual([product]);
    expect(component.loading).toBe(false);
    expect(component.optionsLoading).toBe(false);
    expect(component.optionsError).toContain('You can still search and browse');
  });

  it('stops loading on request failure without displaying stale results, then retries', () => {
    const setupResult = setup();
    component = setupResult.component;
    setupResult.productService.getAllProducts = vi.fn()
      .mockReturnValueOnce(of(listResponse()))
      .mockReturnValueOnce(throwError(() => ({ error: { error: 'Temporary catalogue failure' } })))
      .mockReturnValueOnce(of(listResponse([product], 1, 1)));

    component.ngOnInit();
    completeDebouncedRequest();
    expect(component.products).toEqual([product]);

    component.loadProducts();
    completeDebouncedRequest();
    expect(component.loading).toBe(false);
    expect(component.errorMessage).toBe('Temporary catalogue failure');
    expect(component.products).toEqual([]);

    component.loadProducts();
    completeDebouncedRequest();
    expect(component.loading).toBe(false);
    expect(component.errorMessage).toBe('');
    expect(component.products).toEqual([product]);
  });

  it('represents an empty catalogue as a successful empty result, not a loading error', () => {
    const setupResult = setup();
    setupResult.productService.getAllProducts = vi.fn().mockReturnValue(of(listResponse([], 1, 0)));
    component = setupResult.component;
    component.ngOnInit();
    completeDebouncedRequest();

    expect(component.products).toEqual([]);
    expect(component.pagination.totalItems).toBe(0);
    expect(component.loading).toBe(false);
    expect(component.errorMessage).toBe('');
  });

  it('resets the page for a changed filter and sends the selected search to the API', () => {
    const setupResult = setup();
    component = setupResult.component;
    component.ngOnInit();
    completeDebouncedRequest();

    component.page = 2;
    component.searchText = 'linen';
    component.onSearchChange();
    completeDebouncedRequest();

    expect(component.page).toBe(1);
    expect(setupResult.productService.getAllProducts).toHaveBeenLastCalledWith(1, 12, expect.objectContaining({ search: 'linen' }));
  });
  it('returns to the last valid page if the result count shrinks between requests', () => {
    const setupResult = setup();
    setupResult.productService.getAllProducts = vi.fn()
      .mockReturnValueOnce(of(listResponse()))
      .mockReturnValueOnce(of({ message: 'Products list', data: [], pagination: { page: 2, pageSize: 12, totalItems: 3, totalPages: 1 } }))
      .mockReturnValueOnce(of(listResponse([product], 1, 3)));
    component = setupResult.component;
    component.ngOnInit();
    expect(component.loading).toBe(false);
    component.page = 2;
    component.loadProducts();
    expect(component.page).toBe(1);
    expect(component.products).toEqual([product]);
    expect(component.loading).toBe(false);
  });

  it('debounces free-text input but applies discrete filter changes immediately', () => {
    const setupResult = setup();
    component = setupResult.component;
    component.ngOnInit();
    expect(setupResult.productService.getAllProducts).toHaveBeenCalledTimes(1);
    component.searchText = 'linen';
    component.onSearchChange();
    expect(setupResult.productService.getAllProducts).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(181);
    expect(setupResult.productService.getAllProducts).toHaveBeenCalledTimes(2);
    component.sort = 'price-asc';
    component.onFilterChange();
    expect(setupResult.productService.getAllProducts).toHaveBeenCalledTimes(3);
  });

});
