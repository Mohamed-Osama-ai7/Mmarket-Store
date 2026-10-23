import { IProduct } from './product.model';

export interface IUser {
  _id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  isActive?: boolean;
  phone?: string;
  address?: string;
  createdAt?: string;
}

export interface ICartItem {
  _id?: string;
  product: IProduct;
  quantity: number;
  variantId?: string;
  variantUnavailable?: boolean;
  productUnavailable?: boolean;
}

export interface ICart {
  _id?: string;
  items: ICartItem[];
  totalItems: number;
  totalPrice: number;
}

export interface IOrderItem {
  _id?: string;
  product: string | IProduct;
  name: string;
  slug: string;
  variantId?: string;
  size?: string;
  color?: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'refunded';

export interface IOrder {
  _id: string;
  user?: string | IUser | null;
  guestName?: string;
  guestEmail?: string;
  items: IOrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  refundStatus?: string;
  createdAt: string;
  completedAt?: string;
  deliveryDetails?: { name?: string; phone?: string; address?: string };
}

export interface IPayment {
  _id: string;
  order: string | IOrder;
  amount: number;
  currency: string;
  method: string;
  provider: string;
  status: string;
  refundStatus?: string;
  createdAt?: string;
}

export interface IRefund {
  _id: string;
  order: string | IOrder;
  payment: string | IPayment;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  reviewNote?: string;
  failureReason?: string;
  createdAt: string;
}

export interface IReview {
  _id: string;
  rating: number;
  comment: string;
  createdAt: string;
  user?: { _id?: string; name: string };
}
