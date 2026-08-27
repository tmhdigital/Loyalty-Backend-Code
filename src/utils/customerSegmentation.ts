import { Types } from "mongoose";
import { Sell } from "../app/modules/merchant/merchantSellManagement/merchantSellManagement.model";
import { CUSTOMER_SEGMENT } from "../enums/user";
import { MerchantCustomer } from "../app/modules/merchant/merchantCustomer/merchantCustomer.model";

export const resolveCustomerIdsBySegment = async ({
    merchantId,
    segment,
    minPoints,
    radiusKm,
    merchantLocation
}: {
    merchantId: Types.ObjectId;
    segment: CUSTOMER_SEGMENT;
    minPoints?: number;
    radiusKm?: number;
    merchantLocation?: { lng: number; lat: number };
}) => {
    /* ---------- VIP / ALL ---------- */
    if (segment === CUSTOMER_SEGMENT.VIP_CUSTOMER) {
        return MerchantCustomer.find({ merchantId, isVip: true })
            .select("customerId");
    }

    if (segment === CUSTOMER_SEGMENT.ALL_CUSTOMER) {
        return MerchantCustomer.find({ merchantId })
            .select("customerId");
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const pipeline: any[] = [
        /* ---------- BASE SELL ---------- */
        {
            $match: {
                merchantId,
                status: "completed",
            },
        },

        /* ---------- GROUP PER CUSTOMER ---------- */
        {
            $group: {
                _id: "$userId",
                purchaseCount: { $sum: 1 },
                totalSpend: { $sum: "$totalBill" },
                lastPurchaseAt: { $max: "$createdAt" },
            },
        },

        /* ---------- SEGMENT LOGIC ---------- */
        ...(segment === CUSTOMER_SEGMENT.NEW_CUSTOMER
            ? [{
                $match: {
                    purchaseCount: { $lte: 1 },
                    lastPurchaseAt: { $gte: thirtyDaysAgo },
                },
            }]
            : []),

        ...(segment === CUSTOMER_SEGMENT.RETURNING_CUSTOMER
            ? [{
                $match: {
                    purchaseCount: { $gte: 2, $lt: 5 },
                },
            }]
            : []),

        ...(segment === CUSTOMER_SEGMENT.LOYAL_CUSTOMER
            ? [{
                $match: {
                    purchaseCount: { $gte: 5 },
                    lastPurchaseAt: { $gte: sixMonthsAgo },
                },
            }]
            : []),

        /* ---------- JOIN MERCHANT CUSTOMER ---------- */
        {
            $lookup: {
                from: "merchantcustomers",
                let: { userId: "$_id" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$customerId", "$$userId"] },
                                    { $eq: ["$merchantId", merchantId] },
                                ],
                            },
                        },
                    },
                ],
                as: "merchantCustomer",
            },
        },
        { $unwind: "$merchantCustomer" },

        /* ---------- POINT FILTER (PER MERCHANT) ---------- */
        ...(minPoints
            ? [{
                $match: {
                    "merchantCustomer.points": { $gte: minPoints },
                },
            }]
            : []),

        /* ---------- JOIN USER (GEO) ---------- */
        {
            $lookup: {
                from: "users",
                localField: "_id",
                foreignField: "_id",
                as: "user",
            },
        },
        { $unwind: "$user" },

        /* ---------- GEO FILTER ---------- */
        ...(radiusKm && merchantLocation
            ? [{
                $match: {
                    "user.location": {
                        $geoWithin: {
                            $centerSphere: [
                                [merchantLocation.lng, merchantLocation.lat],
                                radiusKm / 6378.1,
                            ],
                        },
                    },
                },
            }]
            : []),


        /* ---------- OUTPUT ---------- */
        {
            $project: {
                _id: "$_id",
            },
        },
    ];

    return Sell.aggregate(pipeline);
};
