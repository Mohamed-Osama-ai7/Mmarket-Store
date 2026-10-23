import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ContactService } from '../../../core/services/contact.service';

@Component({ selector: 'app-contact', imports: [FormsModule, RouterLink], templateUrl: './contact.html', styleUrl: './contact.css' })
export class Contact {
  form = { name: '', email: '', subject: '', message: '' };
  busy = false;
  successMessage = '';
  errorMessage = '';
  constructor(private contact: ContactService) {}
  submit(): void {
    this.successMessage = ''; this.errorMessage = '';
    if (this.form.name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.form.email.trim()) || this.form.subject.trim().length < 3 || this.form.message.trim().length < 10) {
      this.errorMessage = 'Please check your name, email, subject, and message before sending.'; return;
    }
    this.busy = true;
    this.contact.submit({ name: this.form.name.trim(), email: this.form.email.trim(), subject: this.form.subject.trim(), message: this.form.message.trim() }).subscribe({
      next: (response) => { this.successMessage = response.message || 'Your message has been received.'; this.form = { name: '', email: '', subject: '', message: '' }; this.busy = false; },
      error: (error) => { this.errorMessage = error?.error?.error || error?.error?.message || 'The message could not be sent. Please try again.'; this.busy = false; },
    });
  }
}
