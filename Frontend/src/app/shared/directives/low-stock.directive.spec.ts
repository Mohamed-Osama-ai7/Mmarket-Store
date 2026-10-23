import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, it, expect, beforeEach } from 'vitest';
import { LowStockDirective } from './low-stock.directive';

@Component({
  standalone: true,
  imports: [LowStockDirective],
  template: `
    <div id="out" [appLowStock]="0">Out</div>
    <div id="low" [appLowStock]="3">Low</div>
    <div id="available" [appLowStock]="10">Available</div>
  `
})
class TestHostComponent {}

describe('LowStockDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  it('sets data-stock-state="out-of-stock" and stock-attention=false when stock is 0', () => {
    const el = fixture.debugElement.query(By.css('#out')).nativeElement as HTMLElement;
    expect(el.getAttribute('data-stock-state')).toBe('out-of-stock');
    expect(el.classList.contains('stock-attention')).toBe(false);
  });

  it('sets data-stock-state="low-stock" and stock-attention=true when stock is between 1 and 5', () => {
    const el = fixture.debugElement.query(By.css('#low')).nativeElement as HTMLElement;
    expect(el.getAttribute('data-stock-state')).toBe('low-stock');
    expect(el.classList.contains('stock-attention')).toBe(true);
  });

  it('sets data-stock-state="available" and stock-attention=false when stock is greater than 5', () => {
    const el = fixture.debugElement.query(By.css('#available')).nativeElement as HTMLElement;
    expect(el.getAttribute('data-stock-state')).toBe('available');
    expect(el.classList.contains('stock-attention')).toBe(false);
  });
});
