import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  const attr = () => document.documentElement.getAttribute('data-theme');

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('applies and stores the chosen theme', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('dark');
    expect(attr()).toBe('dark');
    expect(localStorage.getItem('market-theme')).toBe('dark');
  });

  it('shows the light surface for the dashboard without changing the saved preference', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('dark');
    service.useLightSurface();
    expect(attr()).toBe('light');
    expect(service.currentTheme).toBe('dark');
    expect(localStorage.getItem('market-theme')).toBe('dark');
  });

  it('restores the visitor theme when the dashboard closes', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('dark');
    service.useLightSurface();
    service.restoreSurface();
    expect(attr()).toBe('dark');
  });

  it('keeps the dashboard light if the theme is toggled while it is open', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('light');
    service.useLightSurface();
    service.toggle();
    expect(attr()).toBe('light');
    service.restoreSurface();
    expect(attr()).toBe('dark');
  });
});
