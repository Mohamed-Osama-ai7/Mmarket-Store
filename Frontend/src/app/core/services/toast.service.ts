import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly subject = new BehaviorSubject<ToastMessage | null>(null);
  private nextId = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  readonly toast$ = this.subject.asObservable();

  show(kind: ToastKind, message: string, durationMs = 4500): void {
    this.clearTimeout();
    this.subject.next({ id: ++this.nextId, kind, message });
    if (durationMs > 0) {
      this.timeout = setTimeout(() => this.dismiss(), durationMs);
    }
  }

  dismiss(): void {
    this.clearTimeout();
    this.subject.next(null);
  }

  private clearTimeout(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}
