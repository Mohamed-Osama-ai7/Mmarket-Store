const mongoose = require("mongoose");
const slugify = require("slugify");
const sanitizeHtml = require("sanitize-html");
const SiteContent = require("../model/siteContent.model");

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

function cleanText(value, field, maxLength, { required = false, multiline = false } = {}) {
    if (typeof value !== "string") {
        if (required) throw new Error(`${field} is required`);
        return "";
    }
    const cleaned = sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
    if (required && !cleaned) throw new Error(`${field} is required`);
    if (cleaned.length > maxLength) throw new Error(`${field} must be ${maxLength} characters or fewer`);
    return multiline ? cleaned.replace(/\r\n?/g, "\n") : cleaned.replace(/[\r\n]+/g, " ");
}

function cleanBoolean(value, fallback = false) {
    return typeof value === "boolean" ? value : fallback;
}

function cleanOrder(value, fallback = 0) {
    const order = Number(value);
    if (!Number.isSafeInteger(order) || order < 0 || order > 10000) return fallback;
    return order;
}

function cleanInternalHref(value, field = "Link") {
    const href = cleanText(value, field, 500);
    if (!href) return "/products";
    // CMS navigation is intentionally restricted to same-origin routes.
    if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\") || /[\r\n]/.test(href)) {
        throw new Error(`${field} must be a same-site path beginning with a single slash`);
    }
    return href;
}

function cleanAssetUrl(value, field = "Image URL") {
    const url = cleanText(value, field, 1000);
    if (!url) return "";
    if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return url;
    try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return parsed.toString();
    } catch { /* handled below */ }
    throw new Error(`${field} must be a same-site path or an HTTPS URL`);
}

function cleanSocialUrl(value) {
    const url = cleanText(value, "Social URL", 500, { required: true });
    try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return parsed.toString();
    } catch { /* handled below */ }
    throw new Error("Social links must use HTTPS URLs");
}

function normalizeLinks(input, maximum = 20) {
    if (!Array.isArray(input) || input.length > maximum) throw new Error(`Provide no more than ${maximum} links`);
    return input.map((item, index) => {
        if (!isRecord(item)) throw new Error("Each link must be an object");
        return {
            label: cleanText(item.label, "Link label", 70, { required: true }),
            href: cleanInternalHref(item.href),
            enabled: cleanBoolean(item.enabled, true),
            order: cleanOrder(item.order, index)
        };
    });
}

function normalizeFooter(input) {
    if (!isRecord(input)) throw new Error("Footer content must be an object");
    const linkGroups = input.linkGroups === undefined ? undefined : (() => {
        if (!Array.isArray(input.linkGroups) || input.linkGroups.length > 8) throw new Error("Provide no more than 8 footer groups");
        return input.linkGroups.map((group, index) => {
            if (!isRecord(group)) throw new Error("Each footer group must be an object");
            return {
                heading: cleanText(group.heading, "Footer group heading", 70, { required: true }),
                links: normalizeLinks(group.links || [], 15),
                order: cleanOrder(group.order, index)
            };
        });
    })();
    const socialLinks = input.socialLinks === undefined ? undefined : (() => {
        if (!Array.isArray(input.socialLinks) || input.socialLinks.length > 8) throw new Error("Provide no more than 8 social links");
        return input.socialLinks.map(item => {
            if (!isRecord(item)) throw new Error("Each social link must be an object");
            return {
                label: cleanText(item.label, "Social link label", 40, { required: true }),
                url: cleanSocialUrl(item.url),
                enabled: cleanBoolean(item.enabled, true)
            };
        });
    })();
    const result = {};
    if (hasOwn(input, "description")) result.description = cleanText(input.description, "Footer description", 500);
    if (hasOwn(input, "useDefaultLinks")) result.useDefaultLinks = cleanBoolean(input.useDefaultLinks, true);
    if (linkGroups !== undefined) result.linkGroups = linkGroups;
    if (socialLinks !== undefined) result.socialLinks = socialLinks;
    return result;
}

function normalizeHomepage(input) {
    if (!isRecord(input)) throw new Error("Homepage content must be an object");
    const textFields = {
        heroEyebrow: 80, heroTitle: 100, heroEmphasis: 100, heroDescription: 500,
        primaryButtonText: 60, secondaryButtonText: 60, featuredEyebrow: 80,
        featuredTitle: 100, featuredDescription: 300, closingEyebrow: 80,
        closingTitle: 100, closingDescription: 300, closingButtonText: 60
    };
    const result = {};
    for (const [field, maxLength] of Object.entries(textFields)) {
        if (hasOwn(input, field)) result[field] = cleanText(input[field], field, maxLength);
    }
    for (const field of ["primaryButtonHref", "secondaryButtonHref"]) {
        if (hasOwn(input, field)) result[field] = cleanInternalHref(input[field], field);
    }
    for (const field of ["showTrustStrip", "showCategories", "showProductGrid", "showClosingBanner"]) {
        if (hasOwn(input, field)) result[field] = cleanBoolean(input[field], true);
    }
    if (hasOwn(input, "trustItems")) {
        if (!Array.isArray(input.trustItems) || input.trustItems.length > 6) throw new Error("Provide no more than 6 homepage trust items");
        result.trustItems = input.trustItems.map(item => {
            if (!isRecord(item)) throw new Error("Each trust item must be an object");
            return {
                title: cleanText(item.title, "Trust item title", 90),
                description: cleanText(item.description, "Trust item description", 180)
            };
        });
    }
    if (hasOwn(input, "sections")) {
        if (!Array.isArray(input.sections) || input.sections.length > 12) throw new Error("Provide no more than 12 extra homepage sections");
        result.sections = input.sections.map((section, index) => {
            if (!isRecord(section)) throw new Error("Each homepage section must be an object");
            const type = ["text", "promo", "image-promo"].includes(section.type) ? section.type : "promo";
            return {
                type,
                eyebrow: cleanText(section.eyebrow, "Section eyebrow", 80),
                title: cleanText(section.title, "Section title", 140, { required: true }),
                description: cleanText(section.description, "Section description", 1000, { multiline: true }),
                imageUrl: cleanAssetUrl(section.imageUrl || "", "Section image URL"),
                buttonText: cleanText(section.buttonText, "Section button text", 60),
                buttonHref: cleanInternalHref(section.buttonHref || "/products", "Section button link"),
                enabled: cleanBoolean(section.enabled, true),
                order: cleanOrder(section.order, index)
            };
        });
    }
    return result;
}

async function getMainContent() {
    let content = await SiteContent.findOne({ key: "main" });
    if (content) return content;
    try {
        return await SiteContent.create({ key: "main" });
    } catch (error) {
        if (error?.code !== 11000) throw error;
        content = await SiteContent.findOne({ key: "main" });
        if (!content) throw error;
        return content;
    }
}

function sendValidationError(res, error) {
    const message = typeof error?.message === "string" ? error.message : "Invalid content";
    return res.status(400).json({ error: message.slice(0, 240) });
}

exports.getPublicSiteContent = async (req, res, next) => {
    try {
        const content = await getMainContent();
        const data = content.toObject();
        data.pages = (data.pages || []).filter(page => page.status === "published").map(page => ({
            _id: page._id, title: page.title, slug: page.slug, status: page.status,
            seoTitle: page.seoTitle, seoDescription: page.seoDescription, updatedAt: page.updatedAt
        }));
        data.navigation = (data.navigation || []).filter(link => link.enabled).sort((a, b) => a.order - b.order);
        data.footer.linkGroups = (data.footer.linkGroups || []).map(group => ({
            _id: group._id,
            heading: group.heading,
            order: group.order,
            links: (group.links || []).filter(link => link.enabled).sort((a, b) => a.order - b.order)
        })).filter(group => group.links.length).sort((a, b) => a.order - b.order);
        data.footer.socialLinks = (data.footer.socialLinks || []).filter(link => link.enabled);
        data.homepage.sections = (data.homepage.sections || []).filter(section => section.enabled).sort((a, b) => a.order - b.order);
        return res.status(200).json({ data });
    } catch (error) { return next(error); }
};

exports.getPublicPage = async (req, res, next) => {
    try {
        const slug = cleanText(req.params.slug, "Page slug", 120).toLowerCase();
        const content = await getMainContent();
        const page = content.pages.find(item => item.slug === slug && item.status === "published");
        if (!page) return res.status(404).json({ error: "Page not found" });
        return res.status(200).json({ data: page });
    } catch (error) { return next(error); }
};

exports.getAdminSiteContent = async (req, res, next) => {
    try {
        const content = await getMainContent();
        return res.status(200).json({ data: content });
    } catch (error) { return next(error); }
};

exports.updateAdminSiteContent = async (req, res, next) => {
    try {
        if (!isRecord(req.body)) return res.status(400).json({ error: "A JSON content object is required" });
        const patch = {};
        const body = req.body;
        if (hasOwn(body, "brand")) {
            if (!isRecord(body.brand)) throw new Error("Brand settings must be an object");
            const value = body.brand;
            const brand = {};
            const textFields = { storeName: 80, tagline: 180, contactPhone: 40, seoTitle: 160, seoDescription: 320 };
            for (const [field, maxLength] of Object.entries(textFields)) if (hasOwn(value, field)) brand[field] = cleanText(value[field], field, maxLength);
            for (const field of ["logoUrl", "faviconUrl"]) if (hasOwn(value, field)) brand[field] = cleanAssetUrl(value[field], field);
            if (hasOwn(value, "contactEmail")) {
                const email = cleanText(value.contactEmail, "Contact email", 254).toLowerCase();
                if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Contact email is invalid");
                brand.contactEmail = email;
            }
            patch.brand = brand;
        }
        if (hasOwn(body, "announcement")) {
            if (!isRecord(body.announcement)) throw new Error("Announcement must be an object");
            const value = body.announcement;
            patch.announcement = {};
            if (hasOwn(value, "enabled")) patch.announcement.enabled = cleanBoolean(value.enabled);
            if (hasOwn(value, "text")) patch.announcement.text = cleanText(value.text, "Announcement text", 180);
            if (hasOwn(value, "buttonText")) patch.announcement.buttonText = cleanText(value.buttonText, "Announcement button text", 50);
            if (hasOwn(value, "href")) patch.announcement.href = cleanInternalHref(value.href, "Announcement link");
        }
        if (hasOwn(body, "navigation")) patch.navigation = normalizeLinks(body.navigation, 20);
        if (hasOwn(body, "footer")) patch.footer = normalizeFooter(body.footer);
        if (hasOwn(body, "homepage")) patch.homepage = normalizeHomepage(body.homepage);
        if (!Object.keys(patch).length) return res.status(400).json({ error: "No supported content sections were provided" });

        const content = await SiteContent.findOneAndUpdate(
            { key: "main" },
            { $set: patch, $setOnInsert: { key: "main" } },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );
        return res.status(200).json({ message: "Site content saved", data: content });
    } catch (error) {
        if (error instanceof Error && /required|must be|invalid|provide no more|same-site|HTTPS|object|characters|section/i.test(error.message)) return sendValidationError(res, error);
        return next(error);
    }
};

function normalizePageFields(input, { creating = false } = {}) {
    if (!isRecord(input)) throw new Error("Page details must be an object");
    const result = {};
    if (hasOwn(input, "title") || creating) result.title = cleanText(input.title, "Page title", 120, { required: true });
    if (hasOwn(input, "slug") || creating) {
        const rawSlug = cleanText(input.slug || input.title, "Page slug", 120, { required: true }).toLowerCase();
        const slug = slugify(rawSlug, { lower: true, strict: true, trim: true });
        if (!slug || slug.length > 120) throw new Error("Page slug is invalid");
        result.slug = slug;
    }
    if (hasOwn(input, "body") || creating) result.body = cleanText(input.body || "", "Page content", 50000, { multiline: true });
    if (hasOwn(input, "status")) {
        if (!["draft", "published", "archived"].includes(input.status)) throw new Error("Page status is invalid");
        result.status = input.status;
    }
    if (hasOwn(input, "seoTitle") || creating) result.seoTitle = cleanText(input.seoTitle || "", "SEO title", 160);
    if (hasOwn(input, "seoDescription") || creating) result.seoDescription = cleanText(input.seoDescription || "", "SEO description", 320);
    return result;
}

exports.createAdminPage = async (req, res, next) => {
    try {
        const content = await getMainContent();
        const pageData = normalizePageFields(req.body, { creating: true });
        if (content.pages.length >= 100) return res.status(400).json({ error: "The store supports up to 100 CMS pages; archive an unused page before adding another" });
        if (content.pages.some(page => page.slug === pageData.slug)) return res.status(409).json({ error: "A page with this slug already exists" });
        content.pages.push(pageData);
        await content.save();
        const page = content.pages[content.pages.length - 1];
        return res.status(201).json({ message: "Page created", data: page });
    } catch (error) {
        if (error instanceof Error && /required|must be|invalid|slug|characters|status/i.test(error.message)) return sendValidationError(res, error);
        return next(error);
    }
};

exports.updateAdminPage = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid page ID" });
        const content = await getMainContent();
        const page = content.pages.id(id);
        if (!page) return res.status(404).json({ error: "Page not found" });
        const patch = normalizePageFields(req.body);
        if (patch.slug && content.pages.some(item => item._id.toString() !== id && item.slug === patch.slug)) {
            return res.status(409).json({ error: "A page with this slug already exists" });
        }
        Object.assign(page, patch);
        await content.save();
        return res.status(200).json({ message: "Page updated", data: page });
    } catch (error) {
        if (error instanceof Error && /required|must be|invalid|slug|characters|status/i.test(error.message)) return sendValidationError(res, error);
        return next(error);
    }
};

exports.archiveAdminPage = async (req, res, next) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid page ID" });
        const content = await getMainContent();
        const page = content.pages.id(req.params.id);
        if (!page) return res.status(404).json({ error: "Page not found" });
        page.status = "archived";
        await content.save();
        return res.status(200).json({ message: "Page archived", data: page });
    } catch (error) { return next(error); }
};
