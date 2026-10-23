import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/services/auth.service';

@Component({ selector: 'app-dashboard', imports: [RouterLink, RouterLinkActive, RouterOutlet], templateUrl: './dashboard.html', styleUrl: './dashboard.css' })
export class Dashboard {
  menuOpen = false;
  constructor(public auth: AuthService) {}
}
