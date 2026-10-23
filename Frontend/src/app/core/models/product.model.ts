export interface ICategory {
  _id: string;
  name: string;
  slug: string;
  isActive?: boolean;
}

export interface IProductVariant {
  _id: string;
  size?: string;
  color?: string;
  sku?: string;
  stock: number;
  price?: number;
  isActive?: boolean;
}

export interface IProduct {
  _id: string;
  name: string;
  price: number;
  desc: string;
  stock: number;
  slug: string;
  imgURL: string;
  images?: string[];
  variants?: IProductVariant[];
  sku?: string;
  brand?: string;
  audience?: 'men' | 'women' | 'unisex';
  garmentType?: 'auto' | 'tops' | 'bottoms' | 'one-pieces' | 'accessories';
  category: string | ICategory;
  isActive?: boolean;
  createdAt?: string;
  ratingAverage?: number;
  ratingCount?: number;
}

export interface IProductFilterOptions {
  brands: string[];
  sizes: string[];
  colors: string[];
}
