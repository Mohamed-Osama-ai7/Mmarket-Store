import { Directive, HostBinding, Input } from '@angular/core';

@Directive({
  selector: '[appLowStock]',
  standalone: true,
})
export class LowStockDirective {
  @Input({ required: true }) appLowStock = 0;

  @HostBinding('class.stock-attention')
  get stockAttention(): boolean {
    return this.appLowStock > 0 && this.appLowStock <= 5;
  }

  @HostBinding('attr.data-stock-state')
  get stockState(): string {
    if (this.appLowStock <= 0) return 'out-of-stock';
    return this.appLowStock <= 5 ? 'low-stock' : 'available';
  }
}
