import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { BehaviorSubject, Observable, tap, timeout } from 'rxjs';
import { environment } from '../../../environments/env';
import { ApiResponse } from '../models/api.model';
import { INotification } from '../models/notification.model';

interface NotificationListResponse extends ApiResponse<INotification[]> {
  unreadCount: number;
}

interface SocketConnection {
  on(event: string, listener: (payload?: unknown) => void): SocketConnection;
  disconnect(): void;
}

type SocketIoFactory = (url: string, options: { path: string; auth: { token: string }; transports?: string[] }) => SocketConnection;

declare global {
  interface Window {
    io?: SocketIoFactory;
  }
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly apiURL = `${environment.apiURL}notifications`;
  private readonly notificationsSubject = new BehaviorSubject<INotification[]>([]);
  private readonly unreadCountSubject = new BehaviorSubject<number>(0);
  private socket: SocketConnection | null = null;
  private activeToken = '';
  private sessionGeneration = 0;
  private clientPromise: Promise<SocketIoFactory> | null = null;

  readonly notifications$ = this.notificationsSubject.asObservable();
  readonly unreadCount$ = this.unreadCountSubject.asObservable();

  start(token: string | null): void {
    if (!token || !isPlatformBrowser(this.platformId)) {
      this.stop();
      return;
    }
    if (this.activeToken === token && this.socket) return;
    this.stop();
    this.activeToken = token;
    const generation = this.sessionGeneration;
    this.loadNotifications(generation).subscribe({ error: () => undefined });
    this.loadSocketClient().then((factory) => {
      if (this.activeToken !== token || generation !== this.sessionGeneration || !isPlatformBrowser(this.platformId)) return;
      this.socket = factory(environment.socketURL || '', {
        path: environment.socketPath,
        auth: { token },
        transports: ['websocket', 'polling'],
      });
      this.socket.on('notification:new', (payload) => {
        if (generation !== this.sessionGeneration || this.activeToken !== token) return;
        if (payload && typeof payload === 'object') this.receive(payload as INotification);
      });
      this.socket.on('connect', () => {
        if (generation === this.sessionGeneration && this.activeToken === token) this.loadNotifications(generation).subscribe({ error: () => undefined });
      });
    }).catch(() => {
      // REST notifications remain available when WebSocket transport is blocked.
    });
  }

  stop(): void {
    this.sessionGeneration += 1;
    this.activeToken = '';
    this.socket?.disconnect();
    this.socket = null;
    this.notificationsSubject.next([]);
    this.unreadCountSubject.next(0);
  }

  loadNotifications(generation = this.sessionGeneration): Observable<NotificationListResponse> {
    return this.http.get<NotificationListResponse>(this.apiURL, { params: { page: '1', pageSize: '20' } }).pipe(
      timeout({ first: 12000 }),
      tap((response) => {
        if (generation !== this.sessionGeneration) return;
        this.notificationsSubject.next(response.data || []);
        this.unreadCountSubject.next(Number(response.unreadCount || 0));
      }),
    );
  }

  markRead(id: string): Observable<ApiResponse<INotification>> {
    const generation = this.sessionGeneration;
    return this.http.patch<ApiResponse<INotification>>(`${this.apiURL}/${id}/read`, {}).pipe(
      timeout({ first: 12000 }),
      tap((response) => {
        if (generation !== this.sessionGeneration) return;
        const notification = response.data;
        if (notification) {
          const existing = this.notificationsSubject.value.find((item) => item._id === id);
          if (existing && !existing.readAt) this.unreadCountSubject.next(Math.max(0, this.unreadCountSubject.value - 1));
          this.notificationsSubject.next(this.notificationsSubject.value.map((item) => item._id === id ? { ...item, readAt: notification.readAt || existing?.readAt || new Date().toISOString() } : item));
        }
      }),
    );
  }

  markAllRead(): Observable<ApiResponse<{ updatedCount: number }>> {
    const generation = this.sessionGeneration;
    return this.http.patch<ApiResponse<{ updatedCount: number }>>(`${this.apiURL}/read-all`, {}).pipe(
      timeout({ first: 12000 }),
      tap(() => {
        if (generation !== this.sessionGeneration) return;
        const readAt = new Date().toISOString();
        this.notificationsSubject.next(this.notificationsSubject.value.map((item) => ({ ...item, readAt: item.readAt || readAt })));
        this.unreadCountSubject.next(0);
      }),
    );
  }

  private receive(notification: INotification): void {
    const existing = this.notificationsSubject.value;
    if (existing.some((item) => item._id === notification._id)) return;
    this.notificationsSubject.next([notification, ...existing].slice(0, 20));
    if (!notification.readAt) this.unreadCountSubject.next(this.unreadCountSubject.value + 1);
  }


  private loadSocketClient(): Promise<SocketIoFactory> {
    if (typeof window !== 'undefined' && window.io) return Promise.resolve(window.io);
    if (this.clientPromise) return this.clientPromise;
    this.clientPromise = new Promise<SocketIoFactory>((resolve, reject) => {
      const script = this.document.createElement('script');
      script.src = `${environment.socketURL || ''}${environment.socketPath}/socket.io.js`;
      script.async = true;
      script.onload = () => {
        if (typeof window !== 'undefined' && window.io) resolve(window.io);
        else reject(new Error('The Socket.IO client did not initialize.'));
      };
      script.onerror = () => {
        this.clientPromise = null;
        reject(new Error('The Socket.IO client could not be loaded.'));
      };
      this.document.head.appendChild(script);
    });
    return this.clientPromise;
  }
}
