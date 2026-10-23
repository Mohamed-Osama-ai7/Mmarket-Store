import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type StoreTheme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly storageKey = 'market-theme';
  private readonly themeSubject = new BehaviorSubject<StoreTheme>(this.getInitialTheme());
  readonly theme$ = this.themeSubject.asObservable();

  constructor() {
    this.apply(this.themeSubject.value);
  }

  get currentTheme(): StoreTheme { return this.themeSubject.value; }
  get isDark(): boolean { return this.currentTheme === 'dark'; }

  toggle(): void {
    this.setTheme(this.isDark ? 'light' : 'dark');
  }

  setTheme(theme: StoreTheme): void {
    this.themeSubject.next(theme);
    this.apply(theme);
    if (isPlatformBrowser(this.platformId)) {
      try { localStorage.setItem(this.storageKey, theme); } catch { /* Storage can be disabled by browser policy. */ }
    }
  }

  private getInitialTheme(): StoreTheme {
    if (!isPlatformBrowser(this.platformId)) return 'light';
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved === 'light' || saved === 'dark') return saved;
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch { return 'light'; }
  }

  private apply(theme: StoreTheme): void {
    this.document.documentElement.setAttribute('data-theme', theme);
    this.document.documentElement.style.colorScheme = theme;
  }
}
