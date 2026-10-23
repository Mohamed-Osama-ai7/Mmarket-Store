import { Component, OnInit } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProductService } from '../../core/services/product.service';
import { OrderService } from '../../core/services/order.service';
import { StatusLabelPipe } from '../../shared/pipes/status-label.pipe';
import { ReportService } from '../../core/services/report.service';
import { IProduct } from '../../core/models/product.model';
import { IOrder } from '../../core/models/shop.model';

@Component({ selector: 'app-dashboard-home', imports: [CurrencyPipe, DatePipe, RouterLink, StatusLabelPipe], templateUrl: './home.html', styleUrl: './home.css' })
export class DashboardHome implements OnInit {
  readonly today = new Date();
  products: IProduct[] = []; orders: IOrder[] = []; report: Record<string, unknown> | null = null; loading = true; errorMessage = '';
  constructor(private productService: ProductService, private orderService: OrderService, private reportService: ReportService) {}
  ngOnInit(): void {
    let finished = 0; const done = () => { finished++; if (finished === 3) this.loading = false; };
    this.productService.getAllProducts(1, 100).subscribe({ next: (response) => { this.products = response.data || []; done(); }, error: () => done() });
    this.orderService.getAdminOrders().subscribe({ next: (response) => { this.orders = response.data || []; done(); }, error: (error) => { this.errorMessage = error?.error?.message || 'Order summary is unavailable until the admin order endpoint is connected.'; done(); } });
    this.reportService.getSalesReport().subscribe({ next: (response) => { this.report = response.data; done(); }, error: () => done() });
  }
  get pendingOrders(): number { return this.orders.filter((order) => ['pending', 'confirmed', 'processing'].includes(order.orderStatus)).length; }
  get inventoryUnits(): number { return this.products.reduce((total, product) => total + product.stock, 0); }
}
