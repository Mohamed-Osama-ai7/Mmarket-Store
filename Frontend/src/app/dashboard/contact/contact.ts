import { Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IContactMessage } from '../../core/models/contact.model';
import { ContactService } from '../../core/services/contact.service';

@Component({ selector: 'app-admin-contact', imports: [DatePipe, FormsModule], templateUrl: './contact.html', styleUrl: './contact.css' })
export class AdminContact implements OnInit {
  messages: IContactMessage[] = [];
  statusFilter = 'open';
  loading = true;
  errorMessage = '';
  successMessage = '';
  busyId = '';
  constructor(private contact: ContactService) {}
  ngOnInit(): void { this.load(); }
  load(): void {
    this.loading = true; this.errorMessage = '';
    this.contact.getAdminMessages(1, 50, this.statusFilter).subscribe({
      next: response => { this.messages = response.data || []; this.loading = false; },
      error: error => { this.errorMessage = error?.error?.error || 'Could not load contact messages.'; this.loading = false; }
    });
  }
  update(message: IContactMessage, status: IContactMessage['status']): void {
    this.busyId = message._id; this.errorMessage = ''; this.successMessage = '';
    this.contact.updateStatus(message._id, status).subscribe({
      next: () => { this.busyId = ''; this.successMessage = 'Message status updated.'; this.load(); },
      error: error => { this.busyId = ''; this.errorMessage = error?.error?.error || 'Could not update this message.'; }
    });
  }
}
