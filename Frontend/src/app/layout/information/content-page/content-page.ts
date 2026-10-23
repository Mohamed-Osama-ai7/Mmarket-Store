import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { Subject, switchMap, takeUntil } from 'rxjs';
import { IContentPage } from '../../../core/models/site-content.model';
import { SiteContentService } from '../../../core/services/site-content.service';

@Component({
  selector: 'app-content-page',
  imports: [RouterLink, DatePipe],
  templateUrl: './content-page.html',
  styleUrl: './content-page.css',
})
export class ContentPage implements OnInit, OnDestroy {
  page: IContentPage | null = null;
  loading = true;
  errorMessage = '';
  private readonly destroy$ = new Subject<void>();

  constructor(private route: ActivatedRoute, private siteContentService: SiteContentService, private title: Title, private meta: Meta) {}

  ngOnInit(): void {
    this.route.paramMap.pipe(
      switchMap(params => {
        this.loading = true;
        this.errorMessage = '';
        this.page = null;
        return this.siteContentService.getPublicPage(params.get('slug') || '');
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: response => {
        this.page = response.data;
        this.loading = false;
        this.title.setTitle(`${this.page.seoTitle || this.page.title} | Mmarket`);
        if (this.page.seoDescription) this.meta.updateTag({ name: 'description', content: this.page.seoDescription });
        else this.meta.removeTag("name='description'");
        this.meta.removeTag("name='robots'");
      },
      error: error => {
        this.errorMessage = error?.status === 404 ? 'This page is not available.' : 'Could not load this page right now.';
        this.loading = false;
        this.title.setTitle('Page unavailable | Mmarket');
        this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
      },
    });
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  get paragraphs(): string[] {
    return (this.page?.body || '').split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean);
  }
}
