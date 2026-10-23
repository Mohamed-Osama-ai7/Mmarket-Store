import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { NotificationService } from './core/services/notification.service';
import { GlobalToast } from './shared/global-toast/global-toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, GlobalToast],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  constructor(private auth: AuthService, private notifications: NotificationService) {}

  ngOnInit(): void {
    this.auth.currentUser$.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      this.notifications.start(user ? this.auth.token : null);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.notifications.stop();
  }
}
