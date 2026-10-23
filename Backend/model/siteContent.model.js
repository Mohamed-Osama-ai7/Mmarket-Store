const mongoose = require("mongoose");

const linkSchema = new mongoose.Schema({
    label: { type: String, required: true, trim: true, maxlength: 70 },
    href: { type: String, required: true, trim: true, maxlength: 500 },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0, min: 0, max: 10000 }
});

const footerGroupSchema = new mongoose.Schema({
    heading: { type: String, required: true, trim: true, maxlength: 70 },
    links: { type: [linkSchema], default: [] },
    order: { type: Number, default: 0, min: 0, max: 10000 }
});

const socialLinkSchema = new mongoose.Schema({
    label: { type: String, required: true, trim: true, maxlength: 40 },
    url: { type: String, required: true, trim: true, maxlength: 500 },
    enabled: { type: Boolean, default: true }
});

const trustItemSchema = new mongoose.Schema({
    title: { type: String, trim: true, maxlength: 90, default: "" },
    description: { type: String, trim: true, maxlength: 180, default: "" }
});

const homepageSectionSchema = new mongoose.Schema({
    type: { type: String, enum: ["text", "promo", "image-promo"], default: "promo" },
    eyebrow: { type: String, trim: true, maxlength: 80, default: "" },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
    imageUrl: { type: String, trim: true, maxlength: 1000, default: "" },
    buttonText: { type: String, trim: true, maxlength: 60, default: "" },
    buttonHref: { type: String, trim: true, maxlength: 500, default: "/products" },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0, min: 0, max: 10000 }
});

const pageSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
    body: { type: String, trim: true, maxlength: 50000, default: "" },
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft" },
    seoTitle: { type: String, trim: true, maxlength: 160, default: "" },
    seoDescription: { type: String, trim: true, maxlength: 320, default: "" }
}, { timestamps: true });

const siteContentSchema = new mongoose.Schema({
    key: { type: String, default: "main", unique: true, immutable: true, enum: ["main"] },
    brand: {
        storeName: { type: String, trim: true, maxlength: 80, default: "Mmarket" },
        tagline: { type: String, trim: true, maxlength: 180, default: "Everyday fashion, thoughtfully selected." },
        logoUrl: { type: String, trim: true, maxlength: 1000, default: "" },
        faviconUrl: { type: String, trim: true, maxlength: 1000, default: "" },
        contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
        contactPhone: { type: String, trim: true, maxlength: 40, default: "" },
        seoTitle: { type: String, trim: true, maxlength: 160, default: "Mmarket — Everyday fashion" },
        seoDescription: { type: String, trim: true, maxlength: 320, default: "Discover everyday clothing and shop the Mmarket collection." }
    },
    announcement: {
        enabled: { type: Boolean, default: false },
        text: { type: String, trim: true, maxlength: 180, default: "" },
        buttonText: { type: String, trim: true, maxlength: 50, default: "" },
        href: { type: String, trim: true, maxlength: 500, default: "/products" }
    },
    navigation: { type: [linkSchema], default: [] },
    footer: {
        description: { type: String, trim: true, maxlength: 500, default: "Everyday fashion, thoughtfully selected for your wardrobe." },
        useDefaultLinks: { type: Boolean, default: true },
        linkGroups: { type: [footerGroupSchema], default: [] },
        socialLinks: { type: [socialLinkSchema], default: [] }
    },
    homepage: {
        heroEyebrow: { type: String, trim: true, maxlength: 80, default: "THE EVERYDAY WARDROBE" },
        heroTitle: { type: String, trim: true, maxlength: 100, default: "Good style." },
        heroEmphasis: { type: String, trim: true, maxlength: 100, default: "Feels like you." },
        heroDescription: { type: String, trim: true, maxlength: 500, default: "Easy-to-wear pieces, considered details, and everyday favourites that make getting dressed feel simple." },
        primaryButtonText: { type: String, trim: true, maxlength: 60, default: "Shop the collection" },
        primaryButtonHref: { type: String, trim: true, maxlength: 500, default: "/products" },
        secondaryButtonText: { type: String, trim: true, maxlength: 60, default: "Explore womenswear" },
        secondaryButtonHref: { type: String, trim: true, maxlength: 500, default: "/products?category=women" },
        showTrustStrip: { type: Boolean, default: true },
        showCategories: { type: Boolean, default: true },
        showProductGrid: { type: Boolean, default: true },
        showClosingBanner: { type: Boolean, default: true },
        trustItems: { type: [trustItemSchema], default: [] },
        featuredEyebrow: { type: String, trim: true, maxlength: 80, default: "STRAIGHT FROM OUR CATALOGUE" },
        featuredTitle: { type: String, trim: true, maxlength: 100, default: "The latest edit" },
        featuredDescription: { type: String, trim: true, maxlength: 300, default: "Browse the pieces currently available in the store." },
        closingEyebrow: { type: String, trim: true, maxlength: 80, default: "YOUR NEXT FAVOURITE AWAITS" },
        closingTitle: { type: String, trim: true, maxlength: 100, default: "Wear it your way." },
        closingDescription: { type: String, trim: true, maxlength: 300, default: "Discover pieces made for your everyday." },
        closingButtonText: { type: String, trim: true, maxlength: 60, default: "Start exploring" },
        sections: { type: [homepageSectionSchema], default: [] }
    },
    pages: { type: [pageSchema], default: [] }
}, { timestamps: true, strict: true, minimize: false });

module.exports = mongoose.model("SiteContent", siteContentSchema);
