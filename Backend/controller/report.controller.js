const Order = require("../model/order.model");
const Product = require("../model/product.model");
const User = require("../model/user.model");
const logger = require("../utilities/logger");


// Validate YYYY-MM-DD date values.
const parseDateOnly = value => {

    if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
        return null;
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
    ) {
        return null;
    }

    return date;
};


// Build a date range using an inclusive start
// and an exclusive end.
const buildDateRange = (startDate, endDate, field) => {

    const range = {};

    if (startDate) {
        range.$gte = startDate;
    }

    if (endDate) {

        const endExclusive = new Date(endDate);

        endExclusive.setUTCDate(
            endExclusive.getUTCDate() + 1
        );

        range.$lt = endExclusive;
    }

    return Object.keys(range).length > 0
        ? { [field]: range }
        : {};
};


// Get sales reports (Admin only).
exports.getSalesReport = async (req, res) => {

    try {

        const { fromDate, toDate } = req.query;


        // ------------------------------------------
        // 1. VALIDATE DATES
        // ------------------------------------------

        const startDate = fromDate === undefined
            ? null
            : parseDateOnly(fromDate);

        const endDate = toDate === undefined
            ? null
            : parseDateOnly(toDate);


        if (fromDate !== undefined && !startDate) {

            return res.status(400).json({
                error: "fromDate must be a valid YYYY-MM-DD date"
            });

        }


        if (toDate !== undefined && !endDate) {

            return res.status(400).json({
                error: "toDate must be a valid YYYY-MM-DD date"
            });

        }


        if (
            startDate &&
            endDate &&
            startDate.getTime() > endDate.getTime()
        ) {

            return res.status(400).json({
                error: "fromDate cannot be later than toDate"
            });

        }


        // ------------------------------------------
        // 2. BUILD DATE FILTERS
        // ------------------------------------------

        // Orders created during the selected period.
        const createdAtMatch = buildDateRange(
            startDate,
            endDate,
            "createdAt"
        );


        // Orders completed during the selected period.
        const completedAtMatch = buildDateRange(
            startDate,
            endDate,
            "completedAt"
        );


        // Only completed and paid orders count as revenue.
        const completedPaidMatch = {
            orderStatus: "completed",
            paymentStatus: "paid",
            ...completedAtMatch
        };


        // Conditions for filtering orders by createdAt.
        const createdAtConditions = [];


        if (startDate) {

            createdAtConditions.push({
                $gte: [
                    "$createdAt",
                    startDate
                ]
            });

        }


        if (endDate) {

            const endExclusive = new Date(endDate);

            endExclusive.setUTCDate(
                endExclusive.getUTCDate() + 1
            );

            createdAtConditions.push({
                $lt: [
                    "$createdAt",
                    endExclusive
                ]
            });

        }


        // Conditions for filtering orders by completedAt.
        const completedAtConditions = [];


        if (startDate) {

            completedAtConditions.push({
                $gte: [
                    "$completedAt",
                    startDate
                ]
            });

        }


        if (endDate) {

            const endExclusive = new Date(endDate);

            endExclusive.setUTCDate(
                endExclusive.getUTCDate() + 1
            );

            completedAtConditions.push({
                $lt: [
                    "$completedAt",
                    endExclusive
                ]
            });

        }


        const createdInRangeExpression =
            createdAtConditions.length > 0
                ? { $and: createdAtConditions }
                : true;


        const completedInRangeExpression =
            completedAtConditions.length > 0
                ? { $and: completedAtConditions }
                : true;


        // An order counts as completed revenue only when:
        // 1. Its status is completed.
        // 2. Its payment status is paid.
        // 3. Its completedAt date matches the selected period.

        const completedAndPaidExpression = {
            $and: [
                {
                    $eq: [
                        "$orderStatus",
                        "completed"
                    ]
                },
                {
                    $eq: [
                        "$paymentStatus",
                        "paid"
                    ]
                },
                completedInRangeExpression
            ]
        };


        // ------------------------------------------
        // 3. MAIN REPORT AGGREGATION
        // ------------------------------------------

        const reportResult = await Order.aggregate([

            {
                $facet: {

                    // ==================================
                    // A. OVERALL STATISTICS
                    // ==================================

                    overallStats: [

                        {
                            $group: {

                                _id: null,


                                // All orders created in the period.
                                totalOrders: {
                                    $sum: {
                                        $cond: [
                                            createdInRangeExpression,
                                            1,
                                            0
                                        ]
                                    }
                                },


                                // Pending orders.
                                pendingOrders: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $and: [
                                                    {
                                                        $eq: [
                                                            "$orderStatus",
                                                            "pending"
                                                        ]
                                                    },
                                                    createdInRangeExpression
                                                ]
                                            },
                                            1,
                                            0
                                        ]
                                    }
                                },


                                // Confirmed or processing orders.
                                processingOrders: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $and: [
                                                    {
                                                        $in: [
                                                            "$orderStatus",
                                                            [
                                                                "confirmed",
                                                                "processing",
                                                                "processing"
                                                            ]
                                                        ]
                                                    },
                                                    createdInRangeExpression
                                                ]
                                            },
                                            1,
                                            0
                                        ]
                                    }
                                },


                                // Cancelled orders.
                                cancelledOrders: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $and: [
                                                    {
                                                        $eq: [
                                                            "$orderStatus",
                                                            "cancelled"
                                                        ]
                                                    },
                                                    createdInRangeExpression
                                                ]
                                            },
                                            1,
                                            0
                                        ]
                                    }
                                },


                                // Completed and paid orders.
                                completedOrders: {
                                    $sum: {
                                        $cond: [
                                            completedAndPaidExpression,
                                            1,
                                            0
                                        ]
                                    }
                                },


                                // Total revenue.
                                totalRevenue: {
                                    $sum: {
                                        $cond: [
                                            completedAndPaidExpression,
                                            "$total",
                                            0
                                        ]
                                    }
                                },


                                // Total quantity of products sold.
                                totalItemsSold: {
                                    $sum: {
                                        $cond: [
                                            completedAndPaidExpression,
                                            {
                                                $reduce: {
                                                    input: "$items",
                                                    initialValue: 0,
                                                    in: {
                                                        $add: [
                                                            "$$value",
                                                            "$$this.quantity"
                                                        ]
                                                    }
                                                }
                                            },
                                            0
                                        ]
                                    }
                                },


                                // Average completed order value.
                                averageOrderValue: {
                                    $avg: {
                                        $cond: [
                                            completedAndPaidExpression,
                                            "$total",
                                            null
                                        ]
                                    }
                                }

                            }
                        },


                        {
                            $project: {

                                _id: 0,

                                totalOrders: 1,
                                pendingOrders: 1,
                                processingOrders: 1,
                                cancelledOrders: 1,
                                completedOrders: 1,
                                totalRevenue: 1,
                                totalItemsSold: 1,


                                averageOrderValue: {
                                    $ifNull: [
                                        "$averageOrderValue",
                                        0
                                    ]
                                }

                            }
                        }

                    ],


                    // ==================================
                    // B. ORDER STATUS SUMMARY
                    // ==================================

                    statusSummary: [

                        ...(Object.keys(createdAtMatch).length > 0
                            ? [
                                {
                                    $match: createdAtMatch
                                }
                            ]
                            : []),


                        {
                            $group: {

                                _id: {
                                    orderStatus: "$orderStatus",
                                    paymentStatus: "$paymentStatus"
                                },

                                count: {
                                    $sum: 1
                                },

                                totalAmount: {
                                    $sum: "$total"
                                }

                            }
                        },


                        {
                            $project: {

                                _id: 0,

                                orderStatus: "$_id.orderStatus",
                                paymentStatus: "$_id.paymentStatus",

                                count: 1,
                                totalAmount: 1

                            }
                        },


                        {
                            $sort: {
                                orderStatus: 1,
                                paymentStatus: 1
                            }
                        }

                    ],


                    // ==================================
                    // C. BEST-SELLING PRODUCTS
                    // ==================================

                    bestSellingProducts: [

                        {
                            $match: completedPaidMatch
                        },


                        {
                            $unwind: "$items"
                        },


                        {
                            $group: {

                                _id: "$items.product",


                                name: {
                                    $first: "$items.name"
                                },


                                slug: {
                                    $first: "$items.slug"
                                },


                                // Total quantity sold.
                                quantitySold: {
                                    $sum: "$items.quantity"
                                },


                                // Product line-item revenue.
                                revenue: {
                                    $sum: "$items.totalPrice"
                                },


                                // Unique orders containing this product.
                                orderCount: {
                                    $addToSet: "$_id"
                                }

                            }
                        },


                        {
                            $lookup: {

                                from: Product.collection.name,

                                localField: "_id",
                                foreignField: "_id",

                                as: "productDetails"

                            }
                        },


                        {
                            $unwind: {
                                path: "$productDetails",
                                preserveNullAndEmptyArrays: true
                            }
                        },


                        {
                            $project: {

                                _id: 0,

                                productId: "$_id",


                                // Use the current product name if available.
                                // Otherwise, use the order item snapshot.

                                name: {
                                    $ifNull: [
                                        "$productDetails.name",
                                        "$name"
                                    ]
                                },


                                slug: {
                                    $ifNull: [
                                        "$productDetails.slug",
                                        "$slug"
                                    ]
                                },


                                quantitySold: 1,
                                revenue: 1,


                                ordersCount: {
                                    $size: "$orderCount"
                                }

                            }
                        },


                        // Most sold first, then highest revenue.
                        {
                            $sort: {
                                quantitySold: -1,
                                revenue: -1,
                                name: 1
                            }
                        },


                        {
                            $limit: 10
                        }

                    ],


                    // ==================================
                    // D. TOP CUSTOMERS
                    // ==================================

                    topCustomers: [

                        {
                            $match: completedPaidMatch
                        },


                        {
                            $group: {

                                _id: "$user",


                                completedOrders: {
                                    $sum: 1
                                },


                                totalItemsPurchased: {
                                    $sum: {
                                        $reduce: {
                                            input: "$items",
                                            initialValue: 0,
                                            in: {
                                                $add: [
                                                    "$$value",
                                                    "$$this.quantity"
                                                ]
                                            }
                                        }
                                    }
                                },


                                totalSpent: {
                                    $sum: "$total"
                                },


                                lastOrderAt: {
                                    $max: "$completedAt"
                                }

                            }
                        },


                        {
                            $lookup: {

                                from: User.collection.name,

                                localField: "_id",
                                foreignField: "_id",

                                as: "customer"

                            }
                        },


                        {
                            $unwind: {
                                path: "$customer",
                                preserveNullAndEmptyArrays: true
                            }
                        },


                        {
                            $project: {

                                _id: 0,

                                userId: "$_id",


                                name: {
                                    $ifNull: [
                                        "$customer.name",
                                        "Unavailable customer"
                                    ]
                                },


                                email: {
                                    $ifNull: [
                                        "$customer.email",
                                        null
                                    ]
                                },


                                completedOrders: 1,
                                totalItemsPurchased: 1,
                                totalSpent: 1,
                                lastOrderAt: 1

                            }
                        },


                        // Highest total spending first.
                        {
                            $sort: {
                                totalSpent: -1,
                                completedOrders: -1
                            }
                        },


                        {
                            $limit: 10
                        }

                    ],


                    // ==================================
                    // E. DAILY SALES
                    // ==================================

                    salesByDay: [

                        {
                            $match: completedPaidMatch
                        },


                        // One document per order item.
                        {
                            $unwind: "$items"
                        },


                        // Recombine items into one order.
                        // This prevents counting an order multiple times.

                        {
                            $group: {

                                _id: "$_id",

                                completedAt: {
                                    $first: "$completedAt"
                                },

                                total: {
                                    $first: "$total"
                                },

                                quantity: {
                                    $sum: "$items.quantity"
                                }

                            }
                        },


                        // Group orders by calendar day.
                        {
                            $group: {

                                _id: {
                                    $dateToString: {
                                        format: "%Y-%m-%d",
                                        date: "$completedAt",
                                        timezone: "UTC"
                                    }
                                },


                                completedOrders: {
                                    $sum: 1
                                },


                                totalItemsSold: {
                                    $sum: "$quantity"
                                },


                                revenue: {
                                    $sum: "$total"
                                }

                            }
                        },


                        // Oldest day to newest day.
                        {
                            $sort: {
                                _id: 1
                            }
                        }

                    ],


                    // ==================================
                    // F. MONTHLY SALES
                    // ==================================

                    salesByMonth: [

                        {
                            $match: completedPaidMatch
                        },


                        // Separate order items.
                        {
                            $unwind: "$items"
                        },


                        // Recombine items into one order.
                        {
                            $group: {

                                _id: "$_id",

                                completedAt: {
                                    $first: "$completedAt"
                                },

                                total: {
                                    $first: "$total"
                                },

                                quantity: {
                                    $sum: "$items.quantity"
                                }

                            }
                        },


                        // Group completed orders by year and month.
                        {
                            $group: {

                                _id: {
                                    $dateToString: {
                                        format: "%Y-%m",
                                        date: "$completedAt",
                                        timezone: "UTC"
                                    }
                                },


                                // Number of completed orders in the month.
                                completedOrders: {
                                    $sum: 1
                                },


                                // Total quantity of products sold.
                                totalItemsSold: {
                                    $sum: "$quantity"
                                },


                                // Total revenue for the month.
                                revenue: {
                                    $sum: "$total"
                                }

                            }
                        },


                        // Chronological order:
                        // 2026-01, 2026-02, 2026-03, ...
                        {
                            $sort: {
                                _id: 1
                            }
                        }

                    ]

                }
            }

        ]);


        // ------------------------------------------
        // 4. PREPARE REPORT RESPONSE
        // ------------------------------------------

        const report = reportResult[0] || {};


        const overallStats = report.overallStats?.[0] || {

            totalOrders: 0,
            pendingOrders: 0,
            processingOrders: 0,
            cancelledOrders: 0,
            completedOrders: 0,
            totalRevenue: 0,
            totalItemsSold: 0,
            averageOrderValue: 0

        };


        // ------------------------------------------
        // 5. SEND RESPONSE
        // ------------------------------------------

        return res.status(200).json({

            message: "Sales reports retrieved successfully",


            filters: {

                fromDate: fromDate || null,
                toDate: toDate || null,

                // Order counts use creation date.
                orderCountsDateField: "createdAt",

                // Revenue uses completion date.
                revenueDateField: "completedAt",


                // Revenue includes completed and paid orders.
                revenueCriteria: {
                    orderStatus: "completed",
                    paymentStatus: "paid"
                }

            },


            data: {

                overallStats,

                statusSummary: report.statusSummary || [],

                bestSellingProducts:
                    report.bestSellingProducts || [],

                topCustomers:
                    report.topCustomers || [],

                salesByDay:
                    report.salesByDay || [],

                salesByMonth:
                    report.salesByMonth || []

            }

        });

    } catch (err) {

        logger.logError("reports.sales.generate.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(500).json({
            error: "Internal server error"
        });

    }

};
