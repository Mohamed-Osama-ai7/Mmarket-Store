import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReportService } from '../../core/services/report.service';

@Component({ selector: 'app-admin-reports', imports: [FormsModule], templateUrl: './reports.html', styleUrl: './reports.css' })
export class AdminReports {
  fromDate = ''; toDate = ''; report: Record<string, unknown> | null = null; loading = false; errorMessage = '';
  constructor(private reportService: ReportService) { this.loadReport(); }
  get overallStats(): { key: string; label: string; value: unknown }[] {
    const values = this.report?.['overallStats'];
    if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
    return Object.entries(values as Record<string, unknown>).map(([key, value]) => ({ key, label: this.label(key), value }));
  }
  get statusSummary(): Record<string, unknown>[] { const values = this.report?.['statusSummary']; return Array.isArray(values) ? values as Record<string, unknown>[] : []; }
  get bestSellingProducts(): Record<string, unknown>[] { const values = this.report?.['bestSellingProducts']; return Array.isArray(values) ? values as Record<string, unknown>[] : []; }
  loadReport(): void { this.errorMessage = ''; this.loading = true; this.reportService.getSalesReport(this.fromDate || undefined, this.toDate || undefined).subscribe({ next: (response) => { this.report = response.data || null; this.loading = false; }, error: (error) => { this.report = null; this.errorMessage = error?.error?.error || error?.error?.message || 'Could not load sales report.'; this.loading = false; } }); }
  label(value: string): string { return value.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/^./, (letter) => letter.toUpperCase()); }
  objectEntries(row: Record<string, unknown>): { key: string; value: unknown }[] { return Object.entries(row).map(([key, value]) => ({ key, value })); }
  displayValue(value: unknown): string { if (value === null || value === undefined) return '—'; if (typeof value === 'number') return value.toLocaleString(); if (typeof value === 'string' || typeof value === 'boolean') return String(value); return JSON.stringify(value); }
}
