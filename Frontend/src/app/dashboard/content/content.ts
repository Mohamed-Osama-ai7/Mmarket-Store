import { Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IContentPage, IContentPageInput, IFooterGroup, IHomepageSection, IHomepageTrustItem, ISiteContent, ISiteContentUpdate, ISiteLink, ISocialLink } from '../../core/models/site-content.model';
import { SiteContentService } from '../../core/services/site-content.service';

const emptyPage = (): IContentPageInput => ({ title: '', slug: '', body: '', status: 'draft', seoTitle: '', seoDescription: '' });

@Component({
  selector: 'app-admin-content',
  imports: [FormsModule, RouterLink, DatePipe],
  templateUrl: './content.html',
  styleUrl: './content.css',
})
export class AdminContent implements OnInit {
  content: ISiteContent | null = null;
  loading = true;
  saving = false;
  pageSaving = false;
  errorMessage = '';
  successMessage = '';
  pageError = '';
  pageMessage = '';
  pageDraft: IContentPageInput = emptyPage();
  editingPageId: string | null = null;

  constructor(private siteContentService: SiteContentService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.errorMessage = '';
    this.siteContentService.getAdminContent().subscribe({
      next: response => {
        this.content = response.data;
        this.content.navigation ||= [];
        this.content.footer.linkGroups ||= [];
        this.content.footer.socialLinks ||= [];
        this.content.homepage.trustItems ||= [];
        this.content.homepage.sections ||= [];
        this.content.pages ||= [];
        this.loading = false;
      },
      error: error => {
        this.errorMessage = error?.error?.error || error?.error?.message || 'Could not load site content. Confirm that you are signed in as an administrator.';
        this.loading = false;
      },
    });
  }

  saveContent(): void {
    if (!this.content || this.saving) return;
    this.saving = true;
    this.errorMessage = '';
    this.successMessage = '';
    const payload: ISiteContentUpdate = {
      brand: this.content.brand,
      announcement: this.content.announcement,
      navigation: this.content.navigation,
      footer: this.content.footer,
      homepage: this.content.homepage,
    };
    this.siteContentService.saveAdminContent(payload).subscribe({
      next: response => {
        this.content = response.data;
        this.saving = false;
        this.successMessage = 'Site content saved. Published changes will appear on the storefront when it loads the content again.';
      },
      error: error => {
        this.saving = false;
        this.errorMessage = error?.error?.error || error?.error?.message || 'Could not save the site content. Review the fields and try again.';
      },
    });
  }

  addNavigationLink(): void {
    this.content?.navigation.push({ label: '', href: '/products', enabled: true, order: this.content.navigation.length });
  }
  removeNavigationLink(index: number): void { this.content?.navigation.splice(index, 1); }
  addFooterGroup(): void {
    this.content?.footer.linkGroups.push({ heading: '', links: [], order: this.content.footer.linkGroups.length });
  }
  removeFooterGroup(index: number): void { this.content?.footer.linkGroups.splice(index, 1); }
  addFooterLink(group: IFooterGroup): void { group.links.push({ label: '', href: '/products', enabled: true, order: group.links.length }); }
  removeFooterLink(group: IFooterGroup, index: number): void { group.links.splice(index, 1); }
  addSocialLink(): void { this.content?.footer.socialLinks.push({ label: '', url: 'https://', enabled: true }); }
  removeSocialLink(index: number): void { this.content?.footer.socialLinks.splice(index, 1); }
  addTrustItem(): void { this.content?.homepage.trustItems.push({ title: '', description: '' }); }
  removeTrustItem(index: number): void { this.content?.homepage.trustItems.splice(index, 1); }
  addHomepageSection(): void {
    const sections = this.content?.homepage.sections;
    if (!sections || sections.length >= 12) return;
    sections.push({ type: 'promo', eyebrow: '', title: '', description: '', imageUrl: '', buttonText: '', buttonHref: '/products', enabled: true, order: sections.length });
  }
  removeHomepageSection(index: number): void { this.content?.homepage.sections.splice(index, 1); }
  moveHomepageSection(index: number, offset: number): void {
    const sections = this.content?.homepage.sections;
    if (!sections) return;
    const target = index + offset;
    if (target < 0 || target >= sections.length) return;
    [sections[index], sections[target]] = [sections[target], sections[index]];
    sections.forEach((section, order) => section.order = order);
  }

  editPage(page: IContentPage): void {
    if (!page._id) return;
    this.editingPageId = page._id;
    this.pageDraft = { title: page.title, slug: page.slug, body: page.body, status: page.status, seoTitle: page.seoTitle || '', seoDescription: page.seoDescription || '' };
    this.pageError = '';
    this.pageMessage = '';
  }

  resetPageForm(): void {
    this.editingPageId = null;
    this.pageDraft = emptyPage();
    this.pageError = '';
    this.pageMessage = '';
  }

  savePage(): void {
    if (this.pageSaving) return;
    this.pageSaving = true;
    this.pageError = '';
    this.pageMessage = '';
    const request = this.editingPageId
      ? this.siteContentService.updatePage(this.editingPageId, this.pageDraft)
      : this.siteContentService.createPage(this.pageDraft);
    request.subscribe({
      next: () => {
        this.pageSaving = false;
        this.pageMessage = this.editingPageId ? 'Page updated.' : 'Page created.';
        this.resetPageForm();
        this.load();
      },
      error: error => {
        this.pageSaving = false;
        this.pageError = error?.error?.error || error?.error?.message || 'Could not save the page. Check its title and slug.';
      },
    });
  }

  setPageStatus(page: IContentPage, status: IContentPage['status']): void {
    if (!page._id) return;
    this.pageError = '';
    this.pageMessage = '';
    this.siteContentService.updatePage(page._id, { status }).subscribe({
      next: () => { this.pageMessage = status === 'published' ? 'Page published.' : status === 'draft' ? 'Page moved to draft.' : 'Page archived.'; this.load(); },
      error: error => { this.pageError = error?.error?.error || error?.error?.message || 'Could not update the page status.'; },
    });
  }

  get pages(): IContentPage[] { return this.content?.pages || []; }
  trackLink(_index: number, item: ISiteLink): string { return item._id || `${item.label}:${_index}`; }
  trackSection(_index: number, item: IHomepageSection): string { return item._id || `${item.title}:${_index}`; }
  trackSocial(_index: number, item: ISocialLink): string { return item._id || `${item.label}:${_index}`; }
  trackTrust(_index: number, item: IHomepageTrustItem): string { return item._id || `${item.title}:${_index}`; }
  trackGroup(_index: number, item: IFooterGroup): string { return item._id || `${item.heading}:${_index}`; }
  trackPage(_index: number, item: IContentPage): string { return item._id || item.slug; }
}
