import { Component, OnDestroy, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, catchError, map, of, switchMap, takeUntil, tap } from 'rxjs';
import { IContentPage } from '../../../core/models/site-content.model';
import { SiteContentService } from '../../../core/services/site-content.service';

interface PolicySection { heading: string; paragraphs: string[]; }
interface PolicyContent { title: string; kicker: string; intro: string; sections: PolicySection[]; }

const POLICY_CONTENT: Record<string, PolicyContent> = {
  privacy: {
    title: 'Privacy notice', kicker: 'YOUR DATA, RESPECTED', intro: 'This notice explains the data handled by this educational store application and how it is used to support core account and shopping features.', sections: [
      { heading: 'Information we use', paragraphs: ['Account details such as name and email are used for sign-in, profile management, password recovery, and customer support.', 'Cart items, order records, payment status, reviews, refund requests, and contact messages are stored so the relevant store features can work. Passwords are stored as secure hashes, not plain text.'] },
      { heading: 'How information is used', paragraphs: ['Data is used to operate the account, maintain product and inventory records, fulfil course-project orders, prevent abuse, and help administrators respond to requests.', 'The application may record operational logs and request identifiers for troubleshooting. Logs should not contain passwords, authentication tokens, or password-reset links.'] },
      { heading: 'Retention and security', paragraphs: ['Some records, including orders and audit-relevant records, may be retained for the integrity of the demo store. Account data and messages should be removed or anonymized only through an approved retention process.', 'The project applies security controls, but no website can promise zero risk. Production deployment requires HTTPS, protected secrets, restricted database access, backups, and ongoing security review.'] },
      { heading: 'Your choices', paragraphs: ['You can update profile details, change your password, request password recovery, and contact the administrator through the Contact page.', 'This page is a course-project policy template, not legal advice. Replace it with a reviewed policy before using the application with real customers.'] },
    ]
  },
  terms: {
    title: 'Terms of use', kicker: 'CLEAR EXPECTATIONS', intro: 'These terms describe the intended use of this educational demonstration store.', sections: [
      { heading: 'Using the store', paragraphs: ['Use accurate account information, protect your credentials, and do not attempt to access other users’ data or administrative functions.', 'Product availability, prices, order statuses, and catalogue information are managed by the application and may be changed by an authorized administrator.'] },
      { heading: 'Orders and payments', paragraphs: ['This project supports cash on delivery as a demonstration payment method. It does not collect card details or process online wallet or card payments.', 'An order is subject to inventory availability and the status rules implemented by the store. Administrator actions must not be used to misrepresent payment collection.'] },
      { heading: 'Acceptable use', paragraphs: ['Do not submit unlawful, abusive, malicious, or misleading content; upload prohibited files; disrupt service; or attempt unauthorized access.', 'This application is provided as a final-project demonstration. It is not a promise of commercial availability or uninterrupted service.'] },
      { heading: 'Project notice', paragraphs: ['These terms are a starter template for educational use. Obtain appropriate review and replace example wording before any public commercial launch.'] },
    ]
  },
  returns: {
    title: 'Returns and refunds', kicker: 'HELP WHEN YOU NEED IT', intro: 'The project includes a refund-request workflow for eligible orders and an administrator review process.', sections: [
      { heading: 'Requesting a refund', paragraphs: ['Sign in, open the Refunds page, and submit an eligible request with the related payment, amount, and reason. The backend validates the request against stored order and payment records.', 'Submitting a request does not guarantee approval. An administrator reviews the request and updates its status through the management dashboard.'] },
      { heading: 'Review and status updates', paragraphs: ['The project models the stages pending, approved, rejected, processing, completed, and failed. Status changes are stored in the backend and may trigger an in-app notification.', 'Cash-on-delivery orders must have a valid recorded payment state before a monetary refund can be considered. For this course project, the workflow is an administrative record and does not automatically transfer money.'] },
      { heading: 'Need help?', paragraphs: ['Use the Contact page if you have a question about a refund record. Include only the information needed to identify the issue, and never share your password or authentication token.', 'This is an educational policy template and does not set commercial return periods, delivery promises, or legal rights.'] },
    ]
  }
};

@Component({ selector: 'app-policy', imports: [RouterLink], templateUrl: './policy.html', styleUrl: './policy.css' })
export class Policy implements OnInit, OnDestroy {
  content: PolicyContent | null = null;
  cmsPage: IContentPage | null = null;
  private readonly destroy$ = new Subject<void>();

  constructor(private route: ActivatedRoute, private title: Title, private meta: Meta, private siteContentService: SiteContentService) {}

  get cmsParagraphs(): string[] {
    return (this.cmsPage?.body || '').split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(
      map(params => params.get('page') || ''),
      tap(key => {
        this.content = POLICY_CONTENT[key] || null;
        this.cmsPage = null;
        this.applyPolicyMetadata();
      }),
      switchMap(key => this.siteContentService.getPublicPage(key).pipe(
        map(response => response.data),
        catchError(() => of(null)),
      )),
      takeUntil(this.destroy$),
    ).subscribe(page => {
      this.cmsPage = page;
      this.applyPolicyMetadata();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private applyPolicyMetadata(): void {
    if (this.cmsPage) {
      this.title.setTitle(`${this.cmsPage.seoTitle || this.cmsPage.title} | Mmarket`);
      if (this.cmsPage.seoDescription) this.meta.updateTag({ name: 'description', content: this.cmsPage.seoDescription });
      else this.meta.removeTag("name='description'");
      this.meta.removeTag("name='robots'");
      return;
    }

    if (this.content) {
      this.title.setTitle(`${this.content.title} | Mmarket`);
      this.meta.updateTag({ name: 'description', content: this.content.intro });
      this.meta.removeTag("name='robots'");
    } else {
      this.title.setTitle('Policy not found | Mmarket');
      this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    }
  }
}
