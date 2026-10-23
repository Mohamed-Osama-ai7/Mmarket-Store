const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const Product = require("../model/product.model");
const Category = require("../model/category.model");
const productController = require("../controller/product.controller");
const cache = require("../utilities/cache");
const logger = require("../utilities/logger");

afterEach(() => cache.flushAll());

const invoke = async query => {
    let statusCode = 200;
    let body;
    const response = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(payload) {
            body = payload;
            return this;
        }
    };
    await productController.getProducts({
        query,
        id: "filter-test",
        method: "GET"
    }, response);
    return { statusCode, body };
};

const withProductStubs = async callback => {
    const originals = {
        find: Product.find,
        countDocuments: Product.countDocuments,
        aggregate: Product.aggregate,
        categoryFindOne: Category.findOne,
        logError: logger.logError
    };
    const calls = { filters: [], sorts: [], countFilters: [], aggregatePipelines: [] };

    Product.find = filter => {
        calls.filters.push(filter);
        const query = {
            populate() { return query; },
            sort(value) { calls.sorts.push(value); return query; },
            skip() { return query; },
            limit() { return query; },
            lean: async () => []
        };
        return query;
    };
    Product.countDocuments = async filter => {
        calls.countFilters.push(filter);
        return 0;
    };
    Product.aggregate = async pipeline => {
        calls.aggregatePipelines.push(pipeline);
        const matchStage = pipeline.find(stage => stage.$match);
        if (matchStage) calls.filters.push(matchStage.$match);
        const facetStage = pipeline.find(stage => stage.$facet);
        const aggregateSort = facetStage?.$facet?.data?.find(stage => stage.$sort)?.$sort;
        if (aggregateSort) calls.sorts.push(aggregateSort);
        return [{ data: [], total: [] }];
    };
    logger.logError = () => {};

    try {
        await callback(calls);
    } finally {
        Product.find = originals.find;
        Product.countDocuments = originals.countDocuments;
        Product.aggregate = originals.aggregate;
        Category.findOne = originals.categoryFindOne;
        logger.logError = originals.logError;
    }
};

test("product search is escaped and price filters are applied before pagination", async () => {
    await withProductStubs(async calls => {
        const response = await invoke({
            search: "tee.*",
            minPrice: "10",
            maxPrice: "25.5",
            sort: "price-asc"
        });

        assert.equal(response.statusCode, 200);
        assert.equal(calls.filters.length, 1);
        const filter = calls.filters[0];
        assert.equal(filter.isActive, true);
        assert.ok(filter.$expr?.$and);
        assert.equal(filter.$expr.$and.length, 2);
        assert.equal(filter.$expr.$and[0].$gte[1], 10);
        assert.equal(filter.$expr.$and[1].$lte[1], 25.5);
        assert.ok(filter.$expr.$and.every(comparison => comparison[Object.keys(comparison)[0]][0].$let));
        assert.equal(filter.$or.length, 3);
        assert.ok(filter.$or.every(field => field[Object.keys(field)[0]] instanceof RegExp));
        assert.equal(filter.$or[0].name.source, "tee\\.\\*");
        assert.deepEqual(calls.sorts[0], { __cataloguePrice: 1, _id: 1 });
        assert.ok(calls.aggregatePipelines[0].some(stage => stage.$addFields?.__cataloguePrice));
        assert.equal(calls.countFilters.length, 0);
    });
});

test("price-desc sorting uses the same effective variant price shown on product cards", async () => {
    await withProductStubs(async calls => {
        const response = await invoke({ sort: "price-desc" });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(calls.sorts[0], { __cataloguePrice: -1, _id: 1 });
        assert.ok(calls.aggregatePipelines[0].some(stage => stage.$addFields?.__cataloguePrice));
        assert.ok(calls.aggregatePipelines[0].some(stage => stage.$facet?.data?.some(item => item.$project?.__cataloguePrice === 0)));
    });
});

test("category slug is resolved to an active category ID", async () => {
    await withProductStubs(async calls => {
        const categoryId = "64b000000000000000000001";
        Category.findOne = filter => {
            assert.deepEqual(filter, { slug: "accessories", isActive: true });
            return {
                select() {
                    return { lean: async () => ({ _id: categoryId }) };
                }
            };
        };

        const response = await invoke({ category: "Accessories" });
        assert.equal(response.statusCode, 200);
        assert.equal(calls.filters[0].category, categoryId);
        assert.equal(calls.filters[0].isActive, true);
    });
});

test("invalid price ranges are rejected before accessing products", async () => {
    await withProductStubs(async calls => {
        const response = await invoke({ minPrice: "50", maxPrice: "20" });
        assert.equal(response.statusCode, 400);
        assert.equal(response.body.error, "minPrice cannot be greater than maxPrice");
        assert.equal(calls.filters.length, 0);
        assert.equal(calls.countFilters.length, 0);
    });
});

test("filtered product responses use distinct cache keys", async () => {
    await withProductStubs(async calls => {
        await invoke({ search: "shirt" });
        await invoke({ search: "shoes" });
        await invoke({ search: "shirt" });
        assert.equal(calls.filters.length, 2);
    });
});


test("brand, size and colour are applied together on the server", async () => {
    await withProductStubs(async calls => {
        const response = await invoke({ brand: "Daily Form", size: "M", color: "Olive" });
        assert.equal(response.statusCode, 200);
        const filter = calls.filters[0];
        assert.equal(filter.brand instanceof RegExp, true);
        assert.equal(filter.brand.test("Daily Form"), true);
        assert.equal(filter.brand.test("Another Brand"), false);
        assert.equal(filter.variants.$elemMatch.size.test("m"), true);
        assert.equal(filter.variants.$elemMatch.color.test("olive"), true);
        assert.equal(filter.variants.$elemMatch.stock.$gt, 0);
        assert.equal(filter.variants.$elemMatch.isActive.$ne, false);
    });
});

test("minimum rating rejects values outside the supported range", async () => {
    await withProductStubs(async calls => {
        const response = await invoke({ minRating: "6" });
        assert.equal(response.statusCode, 400);
        assert.match(response.body.error, /minRating/);
        assert.equal(calls.filters.length, 0);
        assert.equal(calls.countFilters.length, 0);
    });
});

test("minimum rating is calculated from persisted reviews, not client-supplied values", async () => {
    const originals = { aggregate: Product.aggregate, find: Product.find, logError: logger.logError };
    let pipeline;
    try {
        Product.aggregate = async value => {
            pipeline = value;
            return [{ data: [{ _id: "product-1", name: "Rated shirt", ratingAverage: 4.5, ratingCount: 2 }], total: [{ count: 1 }] }];
        };
        Product.find = () => { throw new Error("minRating must use the rating aggregation path"); };
        logger.logError = () => {};
        const response = await invoke({ minRating: "4" });
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.data[0].ratingAverage, 4.5);
        assert.equal(response.body.data[0].ratingCount, 2);
        assert.ok(pipeline.some(stage => stage.$lookup?.from === "reviews"));
        assert.ok(pipeline.some(stage => stage.$match?.ratingAverage?.$gte === 4));
    } finally {
        Product.aggregate = originals.aggregate;
        Product.find = originals.find;
        logger.logError = originals.logError;
    }
});
