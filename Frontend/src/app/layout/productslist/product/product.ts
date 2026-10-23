import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AsyncPipe, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { IProduct } from '../../../core/models/product.model';
import { ProductService } from '../../../core/services/product.service';
import { LowStockDirective } from '../../../shared/directives/low-stock.directive';
import { AuthService } from '../../../core/services/auth.service';
import { WishlistService } from '../../../core/services/wishlist.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-product',
  imports: [AsyncPipe, CurrencyPipe, DecimalPipe, RouterLink, LowStockDirective],
  templateUrl: './product.html',
  styleUrl: './product.css',
})
export class Product {
  @Input({ required: true }) myProduct!: IProduct;
  @Output() quickAdd = new EventEmitter<IProduct>();
  wishlistBusy = false;
  @Input() quickAddBusy = false;
  constructor(public productService: ProductService, public wishlist: WishlistService, private auth: AuthService, private router: Router, private toast: ToastService) {}
  toggleWishlist(saved: boolean): void {
    if (this.wishlistBusy) return;
    if (!this.auth.isLoggedIn) {
      this.toast.show('info', 'Sign in to save your favourites.');
      void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    this.wishlistBusy = true;
    const request = saved ? this.wishlist.remove(this.myProduct._id) : this.wishlist.add(this.myProduct._id);
    request.subscribe({
      next: () => { this.wishlistBusy = false; this.toast.show('success', saved ? 'Removed from saved items.' : 'Saved to your wishlist.'); },
      error: (error) => { this.wishlistBusy = false; this.toast.show('error', error?.error?.error || error?.error?.message || 'Could not update saved items.'); },
    });
  }
  get categoryName(): string { return typeof this.myProduct.category === 'string' ? 'Everyday pick' : this.myProduct.category?.name || 'Everyday pick'; }
}
