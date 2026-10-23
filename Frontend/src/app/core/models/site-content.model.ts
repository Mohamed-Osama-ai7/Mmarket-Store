export interface ISiteLink {
  _id?: string;
  label: string;
  href: string;
  enabled: boolean;
  order: number;
}

export interface IFooterGroup {
  _id?: string;
  heading: string;
  links: ISiteLink[];
  order: number;
}

export interface ISocialLink {
  _id?: string;
  label: string;
  url: string;
  enabled: boolean;
}

export interface IHomepageTrustItem {
  _id?: string;
  title: string;
  description: string;
}

export interface IHomepageSection {
  _id?: string;
  type: 'text' | 'promo' | 'image-promo';
  eyebrow: string;
  title: string;
  description: string;
  imageUrl: string;
  buttonText: string;
  buttonHref: string;
  enabled: boolean;
  order: number;
}

export interface IContentPage {
  _id?: string;
  title: string;
  slug: string;
  body: string;
  status: 'draft' | 'published' | 'archived';
  seoTitle: string;
  seoDescription: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ISiteContent {
  _id?: string;
  brand: {
    storeName: string;
    tagline: string;
    logoUrl: string;
    faviconUrl: string;
    contactEmail: string;
    contactPhone: string;
    seoTitle: string;
    seoDescription: string;
  };
  announcement: {
    enabled: boolean;
    text: string;
    buttonText: string;
    href: string;
  };
  navigation: ISiteLink[];
  footer: {
    description: string;
    useDefaultLinks: boolean;
    linkGroups: IFooterGroup[];
    socialLinks: ISocialLink[];
  };
  homepage: {
    heroEyebrow: string;
    heroTitle: string;
    heroEmphasis: string;
    heroDescription: string;
    primaryButtonText: string;
    primaryButtonHref: string;
    secondaryButtonText: string;
    secondaryButtonHref: string;
    showTrustStrip: boolean;
    showCategories: boolean;
    showProductGrid: boolean;
    showClosingBanner: boolean;
    trustItems: IHomepageTrustItem[];
    featuredEyebrow: string;
    featuredTitle: string;
    featuredDescription: string;
    closingEyebrow: string;
    closingTitle: string;
    closingDescription: string;
    closingButtonText: string;
    sections: IHomepageSection[];
  };
  pages: IContentPage[];
}

export type ISiteContentUpdate = Partial<Pick<ISiteContent, 'brand' | 'announcement' | 'navigation' | 'footer' | 'homepage'>>;

export interface IContentPageInput {
  title: string;
  slug: string;
  body: string;
  status: IContentPage['status'];
  seoTitle: string;
  seoDescription: string;
}
