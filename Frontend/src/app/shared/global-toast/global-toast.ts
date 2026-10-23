import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-global-toast',
  imports: [AsyncPipe],
  templateUrl: './global-toast.html',
  styleUrl: './global-toast.css',
})
export class GlobalToast {
  private readonly toastService = inject(ToastService);
  readonly toast$ = this.toastService.toast$;

  dismiss(): void {
    this.toastService.dismiss();
  }
}
