export interface ApiResponse<T> {
  message?: string;
  data: T;
  token?: string;
  pagination?: Pagination;
}

export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiMessageResponse {
  message?: string;
  error?: string;
}
