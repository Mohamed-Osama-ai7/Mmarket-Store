import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { ThemeService } from '../core/services/theme.service';

@Component({ selector: 'app-dashboard', imports: [RouterLink, RouterLinkActive, RouterOutlet], templateUrl: './dashboard.html', styleUrl: './dashboard.css' })
export class Dashboard implements OnInit, OnDestroy {
  menuOpen = false;
  constructor(public auth: AuthService, private theme: ThemeService) {}

  // The dashboard is designed on a light surface; the visitor's saved theme is restored on leaving.
  ngOnInit(): void { this.theme.useLightSurface(); }
  ngOnDestroy(): void { this.theme.restoreSurface(); }
}
