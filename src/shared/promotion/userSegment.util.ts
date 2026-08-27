import { Types } from "mongoose";
import { Sell } from "../../app/modules/merchant/merchantSellManagement/merchantSellManagement.model";

export const getUserSegment = async (userId: string) => {
  const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [agg] = await Sell.aggregate([
    {
      $match: {
        userId: new Types.ObjectId(userId),
        status: "completed",
      },
    },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalPurchases: { $sum: 1 },
              totalSpend: { $sum: "$totalBill" },
            },
          },
        ],
        last6Months: [
          { $match: { createdAt: { $gt: sixMonthsAgo } } },
          { $count: "count" },
        ],
        // Needed only to reproduce the exact "new_customer" edge-case:
        // (1 purchase that happened within the last 30 days).
        firstPurchaseWithin30d: [
          { $match: { createdAt: { $gt: thirtyDaysAgo } } },
          { $count: "count" },
        ],
      },
    },
  ]);

  const totalPurchases = agg?.totals?.[0]?.totalPurchases ?? 0;
  const totalSpend = agg?.totals?.[0]?.totalSpend ?? 0;
  const last6MonthsCount = agg?.last6Months?.[0]?.count ?? 0;
  const recentCount = agg?.firstPurchaseWithin30d?.[0]?.count ?? 0;

  const avgSpend = 10000;

  // ── SAME LOGIC AS BEFORE ─────────────────────────────────────────────
  if (
    totalPurchases === 0 ||
    (totalPurchases === 1 && recentCount === 1)
  ) {
    return "new_customer";
  }

  if (totalPurchases >= 2 && last6MonthsCount < 5) {
    return "returning_customer";
  }

  if (last6MonthsCount >= 20 || totalSpend >= 3 * avgSpend) {
    return "vip_customer";
  }

  if (last6MonthsCount >= 5 || totalSpend >= 1.5 * avgSpend) {
    return "loyal_customer";
  }

  return "all_customer";
};