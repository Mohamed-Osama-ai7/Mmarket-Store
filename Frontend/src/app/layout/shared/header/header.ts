import { Component, Inject, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { AsyncPipe, DatePipe } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import { NotificationService } from '../../../core/services/notification.service';
import { WishlistService } from '../../../core/services/wishlist.service';
import { INotification } from '../../../core/models/notification.model';
import { ThemeService } from '../../../core/services/theme.service';
import { SiteContentService } from '../../../core/services/site-content.service';
import { ISiteContent, ISiteLink } from '../../../core/models/site-content.model';

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive, AsyncPipe, DatePipe],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header implements OnInit, OnDestroy {
  readonly currentUser$: AuthService['currentUser$'];
  readonly cartCount: CartService['cartCount'];
  readonly notifications$: NotificationService['notifications$'];
  readonly unreadCount$: NotificationService['unreadCount$'];
  menuOpen = false;
  notificationsOpen = false;
  notificationLoading = false;
  notificationError = '';
  siteContent: ISiteContent | null = null;
  private readonly destroy$ = new Subject<void>();

  constructor(public auth: AuthService, private router: Router, private cart: CartService, private notifications: NotificationService, private wishlist: WishlistService, public theme: ThemeService, private siteContentService: SiteContentService, private changeDetector: ChangeDetectorRef, @Inject(DOCUMENT) private document: Document) {
    this.currentUser$ = this.auth.currentUser$;
    this.cartCount = this.cart.cartCount;
    this.notifications$ = this.notifications.notifications$;
    this.unreadCount$ = this.notifications.unreadCount$;
  }

  ngOnInit(): void {
    this.siteContentService.getPublicContent().pipe(takeUntil(this.destroy$)).subscribe({
      next: response => {
        this.siteContent = response.data;
        const favicon = this.document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
        if (favicon && response.data.brand?.faviconUrl) favicon.href = response.data.brand.faviconUrl;
        this.changeDetector.markForCheck();
      },
      error: () => { this.siteContent = null; this.changeDetector.markForCheck(); },
    });
    this.auth.currentUser$.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      if (user && this.auth.token) {
        this.cart.refreshCart();
        this.notifications.start(this.auth.token);
        this.wishlist.refresh();
      } else {
        this.cart.resetLocalState();
        this.notifications.stop();
        this.wishlist.resetState();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get navigationItems(): ISiteLink[] {
    const configured = (this.siteContent?.navigation || []).filter(item => item.enabled).sort((a, b) => a.order - b.order);
    return configured.length ? configured : [
      { label: 'Home', href: '/home', enabled: true, order: 0 },
      { label: 'Shop', href: '/products', enabled: true, order: 1 },
    ];
  }

  closeMenu(): void { this.menuOpen = false; }

  logout(): void {
    this.auth.logout();
    this.cart.resetLocalState();
    this.closeMenu();
    this.notificationsOpen = false;
    void this.router.navigate(['/home']);
  }

  toggleNotifications(): void {
    this.notificationsOpen = !this.notificationsOpen;
    if (this.notificationsOpen) this.refreshNotifications();
  }

  refreshNotifications(): void {
    this.notificationLoading = true;
    this.notificationError = '';
    this.notifications.loadNotifications().pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.notificationLoading = false; },
      error: error => {
        this.notificationLoading = false;
        this.notificationError = error?.error?.error || error?.error?.message || 'Could not load notifications. Please retry.';
      },
    });
  }

  openNotification(notification: INotification): void {
    const link = notification.link?.startsWith('/') && !notification.link.startsWith('//') ? notification.link : '/orders';
    this.notificationError = '';
    this.notifications.markRead(notification._id).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => { this.notificationsOpen = false; this.closeMenu(); void this.router.navigateByUrl(link); },
      error: error => { this.notificationError = error?.error?.error || error?.error?.message || 'Could not mark this notification as read. Retry the action.'; },
    });
  }

  markAllRead(): void {
    this.notificationError = '';
    this.notifications.markAllRead().pipe(takeUntil(this.destroy$)).subscribe({
      error: error => { this.notificationError = error?.error?.error || error?.error?.message || 'Could not mark notifications as read. Please retry.'; },
    });
  }
}
