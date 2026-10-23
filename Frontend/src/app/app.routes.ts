import { Routes } from '@angular/router';
import { Layout } from './layout/layout';
import { authGuard, adminGuard } from './core/guards/auth.guard';
import { productResolver } from './core/resolvers/product.resolver';

export const routes: Routes = [
  {
    path: '',
    component: Layout,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', loadComponent: () => import('./layout/home/home').then((module) => module.Home) },
      { path: 'products', loadComponent: () => import('./layout/productslist/productslist').then((module) => module.Productslist) },
      {
        path: 'products/:slug',
        loadComponent: () => import('./layout/productslist/product-details/product-details').then((module) => module.ProductDetails),
        resolve: { product: productResolver },
      },
      { path: 'login', loadComponent: () => import('./layout/login/login').then((module) => module.Login) },
      { path: 'signup', loadComponent: () => import('./layout/signup/signup').then((module) => module.Signup) },
      { path: 'forgot-password', loadComponent: () => import('./layout/password-recovery/forgot-password/forgot-password').then((module) => module.ForgotPassword) },
      { path: 'reset-password', loadComponent: () => import('./layout/password-recovery/reset-password/reset-password').then((module) => module.ResetPassword) },
      { path: 'contact', loadComponent: () => import('./layout/information/contact/contact').then((module) => module.Contact) },
      { path: 'policies/:page', loadComponent: () => import('./layout/information/policy/policy').then((module) => module.Policy) },
      { path: 'pages/:slug', loadComponent: () => import('./layout/information/content-page/content-page').then((module) => module.ContentPage) },
      { path: 'cart', loadComponent: () => import('./layout/cart/cart').then((module) => module.Cart) },
      { path: 'guest-order/:id', loadComponent: () => import('./layout/guest-order/guest-order').then((module) => module.GuestOrder) },
      { path: 'try-on/:slug', canActivate: [authGuard], loadComponent: () => import('./layout/try-on/try-on').then((module) => module.TryOn) },
      { path: 'wishlist', canActivate: [authGuard], loadComponent: () => import('./layout/wishlist/wishlist').then((module) => module.Wishlist) },
      { path: 'checkout', loadComponent: () => import('./layout/checkout/checkout').then((module) => module.Checkout) },
      { path: 'orders', canActivate: [authGuard], loadComponent: () => import('./layout/orders/orders').then((module) => module.Orders) },
      { path: 'profile', canActivate: [authGuard], loadComponent: () => import('./layout/profile/profile').then((module) => module.Profile) },
      { path: 'refunds', canActivate: [authGuard], loadComponent: () => import('./layout/refunds/refunds').then((module) => module.Refunds) },
    ],
  },
  {
    path: 'dashboard',
    canActivate: [adminGuard],
    canActivateChild: [adminGuard],
    loadComponent: () => import('./dashboard/dashboard').then((module) => module.Dashboard),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', loadComponent: () => import('./dashboard/home/home').then((module) => module.DashboardHome) },
      { path: 'products', loadComponent: () => import('./dashboard/products/products').then((module) => module.AdminProducts) },
      { path: 'categories', loadComponent: () => import('./dashboard/categories/categories').then((module) => module.AdminCategories) },
      { path: 'customers', loadComponent: () => import('./dashboard/customers/customers').then((module) => module.AdminCustomers) },
      { path: 'orders', loadComponent: () => import('./dashboard/orders/orders').then((module) => module.AdminOrders) },
      { path: 'refunds', loadComponent: () => import('./dashboard/refunds/refunds').then((module) => module.AdminRefunds) },
      { path: 'reports', loadComponent: () => import('./dashboard/reports/reports').then((module) => module.AdminReports) },
      { path: 'contact', loadComponent: () => import('./dashboard/contact/contact').then((module) => module.AdminContact) },
      { path: 'content', loadComponent: () => import('./dashboard/content/content').then((module) => module.AdminContent) },
    ],
  },
  { path: '**', loadComponent: () => import('./shared/not-found/not-found').then((module) => module.NotFound) },
];
