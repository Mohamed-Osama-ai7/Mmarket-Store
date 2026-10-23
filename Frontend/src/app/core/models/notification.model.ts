export type NotificationType = 'order_created' | 'order_status' | 'payment_status' | 'refund_status' | 'general';

export interface INotification {
  _id: string;
  recipient: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}
