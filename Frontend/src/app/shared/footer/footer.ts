import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteContentService } from '../../core/services/site-content.service';
import { ISiteContent } from '../../core/models/site-content.model';

@Component({
  selector: 'app-footer',
  imports: [RouterLink],
  templateUrl: './footer.html',
  styleUrl: './footer.css',
})
export class Footer implements OnInit {
  readonly year = new Date().getFullYear();
  siteContent: ISiteContent | null = null;
  constructor(private siteContentService: SiteContentService, private changeDetector: ChangeDetectorRef) {}
  ngOnInit(): void {
    this.siteContentService.getPublicContent().subscribe({
      next: response => { this.siteContent = response.data; this.changeDetector.markForCheck(); },
      error: () => { this.siteContent = null; this.changeDetector.markForCheck(); },
    });
  }
}
