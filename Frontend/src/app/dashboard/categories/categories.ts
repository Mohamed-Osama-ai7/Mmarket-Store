import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ICategory } from '../../core/models/product.model';
import { CategoryService } from '../../core/services/category.service';

@Component({ selector: 'app-admin-categories', imports: [FormsModule], templateUrl: './categories.html', styleUrl: './categories.css' })
export class AdminCategories implements OnInit {
  categories: ICategory[] = []; name = ''; editingId = ''; searchText = ''; loading = true; busy = false; errorMessage = ''; successMessage = '';
  constructor(private categoryService: CategoryService) {}
  ngOnInit(): void { this.loadCategories(); }
  get filteredCategories(): ICategory[] { const query = this.searchText.trim().toLowerCase(); return this.categories.filter((category) => !query || `${category.name} ${category.slug}`.toLowerCase().includes(query)); }
  loadCategories(): void { this.loading = true; this.categoryService.getAll().subscribe({ next: (response) => { this.categories = response.data || []; this.loading = false; }, error: (error) => { this.errorMessage = error?.error?.error || 'Could not load categories.'; this.loading = false; } }); }
  edit(category: ICategory): void { this.editingId = category._id; this.name = category.name; this.successMessage = ''; this.errorMessage = ''; }
  reset(): void { this.editingId = ''; this.name = ''; }
  save(): void { this.errorMessage = ''; this.successMessage = ''; if (this.name.trim().length < 1) { this.errorMessage = 'Enter a category name.'; return; } this.busy = true; const request = this.editingId ? this.categoryService.update(this.editingId, this.name.trim()) : this.categoryService.create(this.name.trim()); request.subscribe({ next: () => { this.busy = false; this.successMessage = this.editingId ? 'Category updated.' : 'Category created.'; this.reset(); this.loadCategories(); }, error: (error) => { this.busy = false; this.errorMessage = error?.error?.error || error?.error?.message || 'Could not save this category.'; } }); }
  remove(category: ICategory): void { if (!confirm(`Deactivate “${category.name}”? This keeps the category record but hides it from the storefront.`)) return; this.categoryService.remove(category._id).subscribe({ next: () => { this.successMessage = 'Category deactivated.'; this.loadCategories(); }, error: (error) => this.errorMessage = error?.error?.error || 'Could not deactivate category.' }); }
}
