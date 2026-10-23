require("dotenv").config();
const mongoose = require("mongoose");
const slugify = require("slugify");
const connectDB = require("../config/db.config");
const Category = require("../model/category.model");
const Product = require("../model/product.model");
const productListCache = require("../utilities/productListCache");

const photo = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=82`;

const catalog = [
  { name: "Essential Cotton T-Shirt", category: "Men", price: 449, stock: 34, brand: "Daily Form", audience: "men", garmentType: "tops", image: "photo-1521572163474-6864f9cf17ab", desc: "A dependable everyday tee in soft cotton with a relaxed, easy-to-style fit." },
  { name: "Classic Oxford Shirt", category: "Men", price: 899, stock: 18, brand: "Northline", audience: "men", garmentType: "tops", image: "photo-1596755094514-f87e34085b2c", desc: "A clean button-down shirt made for smart-casual days and weekend plans." },
  { name: "Relaxed Straight Jeans", category: "Men", price: 1199, stock: 16, brand: "Blue Standard", audience: "men", garmentType: "bottoms", image: "photo-1542272604-787c3835535d", desc: "Versatile straight-leg denim with a timeless wash and comfortable everyday shape." },
  { name: "Everyday Zip Jacket", category: "Outerwear", price: 1599, stock: 11, brand: "Northline", audience: "men", garmentType: "tops", image: "photo-1551028719-00167b16eac5", desc: "A lightweight outer layer that works over tees, knits, and casual shirts." },
  { name: "Textured Knit Polo", category: "Men", price: 799, stock: 20, brand: "Daily Form", audience: "men", garmentType: "tops", image: "photo-1618354691373-d851c5c3a990", desc: "A textured polo with a refined finish for an effortless smart-casual look." },
  { name: "Tapered Chino Trousers", category: "Men", price: 999, stock: 14, brand: "Form & Field", audience: "men", garmentType: "bottoms", image: "photo-1594633312681-425c7b97ccd1", desc: "Easy-to-pair chinos with a neat tapered silhouette and all-day comfort." },
  { name: "Minimal Crewneck Sweatshirt", category: "Unisex", price: 1099, stock: 22, brand: "Common Ground", audience: "unisex", garmentType: "tops", image: "photo-1556821840-3a63f95609a7", desc: "A soft crewneck layer with a minimal design for cooler everyday moments." },
  { name: "Everyday Canvas Tote", category: "Accessories", price: 299, stock: 40, brand: "Carry Well", audience: "unisex", garmentType: "accessories", image: "photo-1590874103328-eac38a683ce7", desc: "A reusable everyday tote with room for your daily essentials." },
  { name: "Ribbed Cotton Tank", category: "Women", price: 349, stock: 28, brand: "Daily Form", audience: "women", garmentType: "tops", image: "photo-1503342217505-b0a15ec3261c", desc: "A versatile ribbed tank designed for layering or wearing on its own." },
  { name: "Relaxed Linen Shirt", category: "Women", price: 999, stock: 15, brand: "Form & Field", audience: "women", garmentType: "tops", image: "photo-1598554747436-c9293d6a588f", desc: "An airy relaxed shirt that brings an easy, polished feel to warm-weather outfits." },
  { name: "High-Rise Straight Jeans", category: "Women", price: 1299, stock: 17, brand: "Blue Standard", audience: "women", garmentType: "bottoms", image: "photo-1541099649105-f69ad21f3246", desc: "Classic high-rise denim with a straight leg and an easy everyday fit." },
  { name: "Soft Knit Cardigan", category: "Women", price: 1199, stock: 12, brand: "Common Ground", audience: "women", garmentType: "tops", image: "photo-1434389677669-e08b4cac3105", desc: "A soft knit layer that adds warmth without making an outfit feel heavy." },
  { name: "Everyday Midi Dress", category: "Women", price: 1399, stock: 9, brand: "Form & Field", audience: "women", garmentType: "one-pieces", image: "photo-1515372039744-b8f02a3ae446", desc: "An easy midi dress with a simple silhouette for day-to-evening styling." },
  { name: "Pleated Wide-Leg Trousers", category: "Women", price: 1099, stock: 13, brand: "Northline", audience: "women", garmentType: "bottoms", image: "photo-1509631179647-0177331693ae", desc: "Wide-leg trousers with a clean drape and a polished, modern shape." },
  { name: "Lightweight Puffer Vest", category: "Outerwear", price: 1499, stock: 8, brand: "Northline", audience: "unisex", garmentType: "tops", image: "photo-1544923246-77307dd654cb", desc: "A lightweight vest for layering on breezy mornings and outdoor plans." },
  { name: "Classic Denim Jacket", category: "Outerwear", price: 1699, stock: 10, brand: "Blue Standard", audience: "unisex", garmentType: "tops", image: "photo-1523205771623-e0faa4d2813d", desc: "A wardrobe staple with a timeless denim finish that pairs with almost anything." },
  { name: "Everyday Running Sneakers", category: "Footwear", price: 1899, stock: 19, brand: "Stride", audience: "unisex", garmentType: "accessories", image: "photo-1542291026-7eec264c27ff", desc: "Lightweight casual sneakers for everyday movement and off-duty outfits." },
  { name: "Minimal Crossbody Bag", category: "Accessories", price: 799, stock: 12, brand: "Carry Well", audience: "unisex", garmentType: "accessories", image: "photo-1548036328-c9fa89d128fa", desc: "A compact crossbody bag designed to keep everyday essentials close at hand." },
  { name: "Classic Baseball Cap", category: "Accessories", price: 249, stock: 32, brand: "Carry Well", audience: "unisex", garmentType: "accessories", image: "photo-1588850561407-ed78c282e89b", desc: "A simple adjustable cap for relaxed everyday styling." },
  { name: "Fine Rib Long-Sleeve Top", category: "Women", price: 599, stock: 21, brand: "Daily Form", audience: "women", garmentType: "tops", image: "photo-1566206091558-7f218b696731", desc: "A comfortable long-sleeve top with a fine rib texture and a clean neckline." },
  { name: "Relaxed Graphic Tee", category: "Unisex", price: 499, stock: 26, brand: "Common Ground", audience: "unisex", garmentType: "tops", image: "photo-1576566588028-4147f3842f27", desc: "A relaxed graphic tee made for easy layering and casual everyday wear." },
  { name: "Structured Everyday Blazer", category: "Women", price: 1899, stock: 7, brand: "Form & Field", audience: "women", garmentType: "tops", image: "photo-1591369822096-ffd140ec948f", desc: "A versatile blazer that sharpens a simple outfit without feeling overly formal." },
  { name: "Soft Lounge Joggers", category: "Unisex", price: 749, stock: 24, brand: "Common Ground", audience: "unisex", garmentType: "bottoms", image: "photo-1552902865-b72c031ac5ea", desc: "Comfort-first joggers for relaxed days, travel, and easy off-duty outfits." },
  { name: "Weekend Knit Beanie", category: "Accessories", price: 199, stock: 30, brand: "Carry Well", audience: "unisex", garmentType: "accessories", image: "photo-1576871337622-98d48d1cf531", desc: "A soft knit beanie that adds a practical finishing touch on cooler days." }
];

// Original catalogue additions. Prices are illustrative EGP values calibrated against public Egypt retail listings;
// they are not copied listings or claims that Mmarket is affiliated with those retailers.
const supplementalFamilies = [
  { category: "Men", audience: "men", garmentType: "tops", brand: "Daily Form", image: "photo-1521572163474-6864f9cf17ab", items: [
    ["Boxy Cotton T-Shirt", 399], ["Heavyweight Oversized Tee", 599], ["Heritage Stripe T-Shirt", 449], ["Essential V-Neck Tee", 349], ["Washed Relaxed Fit Tee", 499], ["Contrast Stitch T-Shirt", 549], ["Compact Jersey Long Sleeve Tee", 499], ["Minimal Pocket T-Shirt", 399], ["Everyday Ribbed Tee", 449], ["Textured Weekend Tee", 599]
  ]},
  { category: "Men", audience: "men", garmentType: "tops", brand: "Northline", image: "photo-1618354691373-d851c5c3a990", items: [
    ["Classic Pique Polo", 549], ["Textured Smart Polo", 799], ["Striped Cotton Polo", 699], ["Relaxed Knit Polo", 899], ["Everyday Tipped Polo", 599], ["Soft Collar Polo Shirt", 499]
  ]},
  { category: "Men", audience: "men", garmentType: "tops", brand: "Form & Field", image: "photo-1596755094514-f87e34085b2c", items: [
    ["Regular Fit Poplin Shirt", 899], ["Relaxed Linen Blend Shirt", 1199], ["Fine Stripe Oxford Shirt", 999], ["Camp Collar Summer Shirt", 799], ["Textured Dobby Shirt", 1099], ["Smart Casual Overshirt", 1399], ["Classic Checked Shirt", 999], ["Lightweight Denim Shirt", 1299]
  ]},
  { category: "Men", audience: "men", garmentType: "bottoms", brand: "Blue Standard", image: "photo-1542272604-787c3835535d", items: [
    ["Straight Fit Dark Jeans", 1199], ["Relaxed Washed Jeans", 1299], ["Slim Tapered Jeans", 1099], ["Light Wash Denim Jeans", 1199], ["Baggy Everyday Jeans", 1399], ["Classic Black Jeans", 1299], ["Regular Fit Blue Denim", 999], ["Weekend Stretch Jeans", 1199]
  ]},
  { category: "Men", audience: "men", garmentType: "bottoms", brand: "Northline", image: "photo-1594633312681-425c7b97ccd1", items: [
    ["Tailored Chino Trousers", 1099], ["Relaxed Pleated Trousers", 1299], ["Slim Gabardine Chinos", 999], ["Easy Waist Linen Trousers", 899], ["Straight Leg Everyday Trousers", 1099], ["Technical Stretch Trousers", 1399], ["Casual Twill Pants", 899], ["Smart Office Trousers", 1299]
  ]},
  { category: "Unisex", audience: "unisex", garmentType: "tops", brand: "Common Ground", image: "photo-1556821840-3a63f95609a7", items: [
    ["Relaxed Fleece Hoodie", 999], ["Minimal Zip Hoodie", 1299], ["Heavy Cotton Oversized Hoodie", 1499], ["Everyday Pullover Hoodie", 1099], ["Colorblock Weekend Hoodie", 1199], ["Soft Brushed Hoodie", 999], ["Premium Loopback Hoodie", 1599]
  ]},
  { category: "Unisex", audience: "unisex", garmentType: "tops", brand: "Common Ground", image: "photo-1552902865-b72c031ac5ea", items: [
    ["Classic Crew Sweatshirt", 799], ["Textured Loopback Sweatshirt", 999], ["Relaxed Raglan Sweatshirt", 899], ["Minimal Embroidered Crewneck", 1099], ["Brushed Cotton Sweatshirt", 999], ["Quarter Zip Sweatshirt", 1299]
  ]},
  { category: "Outerwear", audience: "unisex", garmentType: "tops", brand: "Northline", image: "photo-1551028719-00167b16eac5", items: [
    ["Lightweight Utility Jacket", 1799], ["Everyday Harrington Jacket", 1999], ["Relaxed Denim Overshirt", 1499], ["Quilted Layering Vest", 1299], ["Minimal Bomber Jacket", 2199], ["Structured Shirt Jacket", 1699]
  ]},
  { category: "Women", audience: "women", garmentType: "tops", brand: "Form & Field", image: "photo-1503342217505-b0a15ec3261c", items: [
    ["Soft Draped Blouse", 799], ["Ribbed Square-Neck Top", 449], ["Relaxed Linen Blend Blouse", 999], ["Everyday Cropped Tee", 399], ["Textured Button Blouse", 899], ["Lightweight Long Sleeve Top", 599], ["Minimal Satin-Feel Shirt", 1099], ["Classic Cotton Tank", 349], ["Fine Knit Short Sleeve Top", 699], ["Easy Layering Cardigan", 1199]
  ]},
  { category: "Women", audience: "women", garmentType: "bottoms", brand: "Blue Standard", image: "photo-1541099649105-f69ad21f3246", items: [
    ["High-Rise Relaxed Denim Jeans", 1299], ["Relaxed Wide-Leg Jeans", 1499], ["Classic Mom-Fit Denim", 1199], ["Tailored Wide-Leg Trousers", 1199], ["Pleated Everyday Pants", 999], ["Relaxed Linen Trousers", 899], ["Straight Leg Black Jeans", 1299]
  ]},
  { category: "Women", audience: "women", garmentType: "one-pieces", brand: "Form & Field", image: "photo-1515372039744-b8f02a3ae446", items: [
    ["Everyday Cotton Midi Dress", 1299], ["Relaxed Shirt Dress", 1499], ["Soft Jersey Maxi Dress", 1199], ["Minimal Occasion Dress", 1699], ["Easy Summer Day Dress", 999]
  ]},
  { category: "Accessories", audience: "unisex", garmentType: "accessories", brand: "Carry Well", image: "photo-1590874103328-eac38a683ce7", items: [
    ["Structured Everyday Backpack", 899], ["Minimal Wallet", 399], ["Classic Canvas Belt", 299], ["Compact Crossbody Pouch", 649], ["Soft Cotton Baseball Cap", 249]
  ]}
];

const supplementalImagePool = [
  "photo-1521572163474-6864f9cf17ab", "photo-1596755094514-f87e34085b2c",
  "photo-1542272604-787c3835535d", "photo-1551028719-00167b16eac5",
  "photo-1618354691373-d851c5c3a990", "photo-1594633312681-425c7b97ccd1",
  "photo-1556821840-3a63f95609a7", "photo-1590874103328-eac38a683ce7",
  "photo-1503342217505-b0a15ec3261c", "photo-1598554747436-c9293d6a588f",
  "photo-1541099649105-f69ad21f3246", "photo-1434389677669-e08b4cac3105",
  "photo-1515372039744-b8f02a3ae446", "photo-1509631179647-0177331693ae",
  "photo-1544923246-77307dd654cb", "photo-1523205771623-e0faa4d2813d",
  "photo-1542291026-7eec264c27ff", "photo-1548036328-c9fa89d128fa",
  "photo-1588850561407-ed78c282e89b", "photo-1566206091558-7f218b696731",
  "photo-1576566588028-4147f3842f27", "photo-1591369822096-ffd140ec948f",
  "photo-1552902865-b72c031ac5ea", "photo-1576871337622-98d48d1cf531",
  "photo-1539533018447-63fcce2678e3", "photo-1515886657613-9f3515b0c78f",
  "photo-1529139574466-a303027c1d8b", "photo-1503341455253-b2e723bb3dbb",
  "photo-1490481651871-ab68de25d43d", "photo-1483985988355-763728e1935b",
  "photo-1485230895905-ec40ba36b9bc", "photo-1523381210434-271e8be1f52b",
  "photo-1551488831-00ddcb6c6bd3", "photo-1487222477894-8943e31ef7b2",
  "photo-1591047139829-d91aecb6caea", "photo-1551232864-3f0890e580d9"
];
let supplementalImageIndex = 0;
for (const family of supplementalFamilies) {
  for (const [name, price] of family.items) {
    catalog.push({
      name, category: family.category, price, stock: 36 + (catalog.length % 19),
      brand: family.brand, audience: family.audience, garmentType: family.garmentType,
      image: supplementalImagePool[supplementalImageIndex++ % supplementalImagePool.length],
      desc: `${name} from Mmarket's original ${family.brand} collection. A versatile ${family.garmentType === "bottoms" ? "wardrobe bottom" : family.garmentType === "accessories" ? "everyday accessory" : "wardrobe piece"} selected for comfortable, repeat wear and easy styling.`
    });
  }
}

function buildVariants(item, totalStock) {
  let sizes;
  let colors;
  if (/sneaker|shoe/i.test(item.name)) {
    sizes = ["40", "41", "42", "43"];
    colors = ["Black", "White"];
  } else if (item.garmentType === "accessories") {
    sizes = ["One size"];
    colors = /cap|beanie/i.test(item.name) ? ["Black", "Beige", "Navy"] : ["Black", "Beige", "Olive"];
  } else {
    sizes = ["XS", "S", "M", "L", "XL", "XXL"];
    colors = ["Black", "White", "Navy", "Beige", "Olive", "Burgundy"];
  }
  const combinations = sizes.flatMap((size) => colors.map((color) => ({ size, color })));
  const stock = Math.max(0, Math.floor(Number(totalStock) || 0));
  return combinations.map((option, index) => ({
    ...option,
    sku: `${slugify(item.name, { lower: true, strict: true }).toUpperCase().slice(0, 24)}-${slugify(option.size, { lower: true, strict: true }).toUpperCase()}-${slugify(option.color, { lower: true, strict: true }).toUpperCase()}`.slice(0, 60),
    stock: Math.floor(stock / combinations.length) + (index < stock % combinations.length ? 1 : 0),
    isActive: true
  }));
}

async function seedCatalog() {
  await connectDB();
  const categories = new Map();

  for (const name of [...new Set(catalog.map((item) => item.category))]) {
    const slug = slugify(name, { lower: true, strict: true });
    let category = await Category.findOne({ slug });
    if (!category) category = await Category.create({ name });
    else if (!category.isActive) {
      category.isActive = true;
      await category.save();
    }
    categories.set(name, category);
  }

  let inserted = 0;
  let upgraded = 0;
  let skipped = 0;
  for (const item of catalog) {
    const slug = slugify(item.name, { lower: true, strict: true });
    const existing = await Product.findOne({ slug });
    if (existing) {
      // Non-destructive schema upgrade for this seed-owned catalogue item. Preserve total stock and all other fields.
      if (!Array.isArray(existing.variants) || existing.variants.length === 0) {
        existing.variants = buildVariants(item, existing.stock);
        await existing.save();
        upgraded++;
      } else {
        skipped++;
      }
      continue;
    }

    const imageURL = photo(item.image);
    await Product.create({
      name: item.name,
      price: item.price,
      desc: item.desc,
      stock: item.stock,
      variants: buildVariants(item, item.stock),
      imgURL: imageURL,
      images: [imageURL],
      category: categories.get(item.category)._id,
      brand: item.brand,
      audience: item.audience,
      garmentType: item.garmentType,
      isActive: true
    });
    inserted++;
  }

  await productListCache.invalidate();
  console.log(`Catalog seed complete: ${inserted} products added, ${upgraded} existing seed products upgraded with variants, ${skipped} already-variant products kept, ${categories.size} categories ready.`);
}

seedCatalog()
  .catch((error) => {
    console.error("Catalog seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
