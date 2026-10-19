import { StatusCodes } from "http-status-codes";
import { User } from "../user/user.model";
import { APPROVE_STATUS, USER_ROLES, USER_STATUS } from "../../../enums/user";
import ApiError from "../../../errors/ApiErrors";
import QueryBuilder from "../../../utils/queryBuilder";
import { sendNotification } from "../../../helpers/notificationsHelper";
import { NotificationType } from "../notification/notification.model";
import { Types } from "mongoose";
import { Favorite } from "../customer/favorite/favorite.model";
import { Rating } from "../customer/rating/rating.model";
import { sendPushNotification } from "../../../helpers/sendPushNotification";
import { Sell } from "../merchant/merchantSellManagement/merchantSellManagement.model";
import { logger } from "../../../shared/logger";

interface IQuery {
  lat?: number;
  lng?: number;
  radius?: number; // in km
  [key: string]: any;
}

const getAllMerchants = async (query: Record<string, unknown>, user: any) => {
  const {
    address,
    service,
    radius,
    favorite,
    limit = 10,
    page = 1,
    customerPage = 1,
    customerLimit = 500,
    ...rest
  } = query;

  const userId = user?._id;
  const customerSkip = (Number(customerPage) - 1) * Number(customerLimit);

  // 1️⃣ User location
  const userData = await User.findById(userId).select("location").lean();
  const userLocation = userData?.location;

  // 2️⃣ Base query
  const filter: Record<string, unknown> = {
    role: USER_ROLES.MERCHANT,
    verified: true,
    isDeleted: { $ne: true },
  };

  // Customers only see live merchants; admins still see pending ones to approve.
  // Admin-created merchants have no approveStatus, so exclude pending/rejected instead of requiring approved.
  if (user?.role === USER_ROLES.USER) {
    filter.approveStatus = { $nin: [APPROVE_STATUS.PENDING, APPROVE_STATUS.REJECTED] };
    filter.status = USER_STATUS.ACTIVE;
  }

  let baseQuery = User.find(filter);

  if (address) {
    baseQuery = baseQuery.find({
      address: { $regex: address as string, $options: "i" },
    });
  }

  if (service) {
    const safeService = decodeURIComponent(service as string)
      .replace(/\+/g, " ")
      .trim();

    baseQuery = baseQuery.find({
      service: { $regex: safeService, $options: "i" },
    });
  } else {
    logger.warn("No service filter applied");
  }

  if (userLocation && radius) {
    baseQuery = baseQuery.find({
      location: {
        $geoWithin: {
          $centerSphere: [
            userLocation.coordinates,
            Number(radius) / 6378.1,
          ],
        },
      },
    });
  }

  //  QueryBuilder
  const allMerchantsQuery = new QueryBuilder(baseQuery, {
    ...rest,
    limit,
    page,
  })
    .search([
      "firstName",
      "lastName",
      "email",
      "phone",
      "businessName",
      "service",
      "address",
      "customUserId",
      "country",
      "city",
    ])
    .filter()
    .sort()
    .paginate();

  //  Fetch merchants + favorites
  const [allmerchants, pagination, favorites] = await Promise.all([
    allMerchantsQuery.modelQuery.lean(),
    allMerchantsQuery.getPaginationInfo(),
    Favorite.find({ userId }).select("merchantId").lean(),
  ]);

  const favoriteMap = new Set(
    favorites.map((f) => f.merchantId.toString())
  );

  const merchantIds = allmerchants.map((m) => m._id);

  //  Ratings
  const ratingsAgg = await Rating.aggregate([
    { $match: { merchantId: { $in: merchantIds } } },
    {
      $group: {
        _id: "$merchantId",
        avgRating: { $avg: "$rating" },
        ratingCount: { $sum: 1 },
      },
    },
  ]);

  const ratingMap = new Map();
  ratingsAgg.forEach((r) => {
    ratingMap.set(r._id.toString(), {
      avgRating: parseFloat(r.avgRating.toFixed(1)),
      ratingCount: r.ratingCount,
    });
  });

  //  Sales
  const salesAgg = await Sell.aggregate([
    {
      $match: {
        merchantId: { $in: merchantIds },
        status: "completed",
      },
    },
    {
      $group: {
        _id: "$merchantId",
        totalRevenue: { $sum: "$totalBill" },
        totalTransactions: { $sum: 1 },
      },
    },
  ]);

  const salesMap = new Map();
  salesAgg.forEach((s) => {
    salesMap.set(s._id.toString(), {
      totalRevenue: s.totalRevenue,
      totalTransactions: s.totalTransactions,
    });
  });

  //  Customer Stats WITH Pagination
  const customerStatsAgg = await Sell.aggregate([
    {
      $match: {
        merchantId: { $in: merchantIds },
        status: "completed",
      },
    },
    {
      $group: {
        _id: { merchantId: "$merchantId", userId: "$userId" },
        totalSellAmount: { $sum: "$totalBill" },
        totalEarnedPoints: { $sum: "$pointsEarned" },
        totalRedeemedPoints: { $sum: "$pointRedeemed" },
        totalTransactions: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id.userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $project: {
        merchantId: "$_id.merchantId",
        userId: "$_id.userId",
        customUserId: "$user.customUserId",
        name: {
          $trim: {
            input: {
              $concat: [
                { $ifNull: ["$user.firstName", ""] },
                " ",
                { $ifNull: ["$user.lastName", ""] },
              ],
            },
          },
        },
        email: "$user.email",
        totalSellAmount: 1,
        totalEarnedPoints: 1,
        totalRedeemedPoints: 1,
        totalTransactions: 1,
      },
    },
    {
      $group: {
        _id: "$merchantId",
        customers: { $push: "$$ROOT" },
        totalCustomers: { $sum: 1 },
      },
    },
    {
      $project: {
        customers: {
          $slice: ["$customers", customerSkip, Number(customerLimit)],
        },
        totalCustomers: 1,
      },
    },
  ]);

  const customerStatsMap = new Map();
  customerStatsAgg.forEach((stat) => {
    customerStatsMap.set(stat._id.toString(), stat);
  });

  //  Merge
  let merchantsWithData = allmerchants.map((merchant) => {
    const id = (merchant._id as any).toString();
    const customerData = customerStatsMap.get(id);

    return {
      ...merchant,
      isFavorite: favoriteMap.has(id),
      rating: ratingMap.get(id)?.avgRating || 0,
      ratingCount: ratingMap.get(id)?.ratingCount || 0,
      totalRevenue: salesMap.get(id)?.totalRevenue || 0,
      totalTransactions: salesMap.get(id)?.totalTransactions || 0,
      customers: customerData?.customers || [],
      customersPagination: {
        total: customerData?.totalCustomers || 0,
        page: Number(customerPage),
        limit: Number(customerLimit),
        totalPage: Math.ceil(
          (customerData?.totalCustomers || 0) / Number(customerLimit)
        ),
      },
    };
  });

  if (favorite === "true") {
    merchantsWithData = merchantsWithData.filter((m) => m.isFavorite);
  }

  return { allmerchants: merchantsWithData, pagination };
};

const getSingleMerchant = async (id: string) => {
  const merchant = await User.findById(id).lean();

  if (!merchant) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Merchant not found");
  }

  return merchant;
};

const updateMerchant = async (id: string, payload: Record<string, unknown>) => {
  const merchant = await User.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  }).lean();

  if (!merchant) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Merchant not found");
  }

  return merchant;
};

const deleteMerchant = async (id: string) => {
  //  Find merchant
  const merchant = await User.findOne({
    _id: id,
    role: "MERCHANT",
    isDeleted: false,
  });

  if (!merchant) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Merchant not found");
  }

  //  Send push notification to merchant
  if (merchant.fcmToken) {
    await sendPushNotification(
      merchant.fcmToken,
      "Account Suspended",
      "Your merchant account has been suspended by Admin."
    );
  } else {
    logger.warn(`No FCM token for merchant skipping push notification`);
  }

  //  Notify Super Admin(s)
  const superAdmins = await User.find({
    role: USER_ROLES.SUPER_ADMIN,
  }).select("_id fcmToken");

  if (!superAdmins.length) {
    logger.warn("No Super Admin found skipping admin notification");
  } else {
    await sendNotification({
      userIds: superAdmins.map((admin) => admin._id),
      title: `Merchant ${merchant.firstName} (${merchant.email}) has been deleted by Admin.`,
      body: `Merchant ${merchant.firstName} (${merchant.email}) has been deleted by Admin.`,
      type: NotificationType.MANUAL,
    });
  }

  //  Soft delete (suspend merchant instead of hard delete)
  const updatedMerchant = await User.findByIdAndUpdate(
    id,
    {
      $set: {
        status: "suspended", // optional: change status to indicate deletion
        isDeleted: true,
        deletedAt: new Date(),
      },
    },
    { new: true }
  );

  return updatedMerchant;
};

const updateMerchantStatus = async (
  id: string,
  status: "active" | "inActive"
) => {
  const merchant = await User.findByIdAndUpdate(
    id,
    { status },
    { new: true }
  ).lean();

  if (!merchant) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Merchant not found");
  }

  return merchant;
};

const updateMerchantApproveStatus = async (
  id: string,
  approveStatus: APPROVE_STATUS,
  adminId: string
) => {
  const merchant = await User.findById(id).lean();
  if (!merchant) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Merchant not found");
  }

  if (merchant.approveStatus === approveStatus) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Merchant already has this status");
  }
  let data: Record<string, unknown> = {
    approveStatus,
  };
  if (approveStatus === APPROVE_STATUS.APPROVED) {
    const adminName = await User.findById(adminId).select("firstName lastName").lean();
    if (!adminName) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Admin not found");
    }
    data.status = USER_STATUS.ACTIVE;
    // ✅ ADD THESE (IMPORTANT)
    data.subscription = "active";
    data.paymentStatus = "paid";
    data.salesRep = `${adminName.firstName} ${adminName.lastName ?? ""}`.trim();
  }

  const result = await User.findByIdAndUpdate(
    id,
    data,
    { new: true }
  ).lean();

  if (approveStatus === APPROVE_STATUS.APPROVED) {
    if (merchant.fcmToken) {
      await sendPushNotification(
        merchant.fcmToken,
        "Account Approved",
        "Your merchant account has been approved by Admin."
      );
    } else {
      logger.warn(`No FCM token for merchant skipping approval push notification`);
    }

    await sendNotification({
      userIds: [merchant._id],
      title: "Congratulations! Your account Approved",
      body: `Welcome ${merchant.firstName}, Your account has been approved successfully`,
      type: NotificationType.WELCOME,
    });
  }

  const superAdmins = await User.find({
    role: USER_ROLES.SUPER_ADMIN,
  }).select("_id fcmToken");

  await sendNotification({
    userIds: superAdmins.map((admin) => admin._id),
    title: `Merchant ${merchant.firstName} (${merchant.email}) has been approved.`,
    body: `Merchant ${merchant.firstName} (${merchant.email}) has been approved by Admin.`,
    type: NotificationType.MANUAL,
  });

  return result;
};

const getNearbyMerchants = async (query: IQuery, userId: string) => {
  const user = await User.findById(userId).select("location");
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  const lng = user.location?.coordinates?.[0];
  const lat = user.location?.coordinates?.[1];

  if (lng == null || lat == null) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User location not found");
  }

  const radius = query.radius ? Number(query.radius) : 1000000; // km
  const searchTerm = query.searchTerm ? String(query.searchTerm) : null;
  const radiusInMeters = radius * 1000;

  const pipeline: any[] = [
    {
      $geoNear: {
        near: {
          type: "Point",
          coordinates: [lng, lat],
        },
        distanceField: "distance",
        spherical: true,
        maxDistance: radiusInMeters,
      },
    },
    {
      $match: {
        role: USER_ROLES.MERCHANT,
        status: USER_STATUS.ACTIVE,
        approveStatus: { $nin: [APPROVE_STATUS.PENDING, APPROVE_STATUS.REJECTED] },
        isDeleted: { $ne: true },
      },
    },
    {
      $project: {
        firstName: 1,
        profile: 1,
        distance: 1,
        address: { $ifNull: ["$address", ""] },
        lng: { $arrayElemAt: ["$location.coordinates", 0] },
        lat: { $arrayElemAt: ["$location.coordinates", 1] },
      },
    },
  ];

  if (searchTerm) {
    pipeline.push({
      $match: {
        firstName: { $regex: searchTerm, $options: "i" },
      },
    });
  }

  pipeline.push(
    {
      $lookup: {
        from: "ratings",
        localField: "_id",
        foreignField: "merchantId",
        as: "ratings",
      },
    },
    {
      $addFields: {
        totalRatings: { $size: "$ratings" },
        avgRating: {
          $cond: [
            { $gt: [{ $size: "$ratings" }, 0] },
            { $round: [{ $avg: "$ratings.rating" }, 1] },
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        address: {
          $concat: [
            { $ifNull: ["$address", ""] },
          ],
        },
      },
    },
    { $sort: { distance: 1 } }
  );

  const merchants = await User.aggregate(pipeline);
  return merchants;
};

const getMerchantCustomerStats = async (
  merchantId: string,
  query: Record<string, unknown>
) => {
  const limit = Number(query.limit) || 10;
  const page = Number(query.page) || 1;
  const skip = (page - 1) * limit;

  // ===============================
  // 🔥 Aggregation Pipeline
  // ===============================
  const pipeline: any[] = [
    {
      $match: {
        merchantId: new Types.ObjectId(merchantId),
        status: "completed",
      },
    },
    {
      $group: {
        _id: "$userId",
        totalSellAmount: { $sum: "$totalBill" },
        totalEarnedPoints: { $sum: "$pointsEarned" },
        totalRedeemedPoints: { $sum: "$pointRedeemed" },
        totalTransactions: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $project: {
        userId: "$_id",
        customUserId: "$user.customUserId",
        name: {
          $concat: [
            { $ifNull: ["$user.firstName", ""] },
            " ",
            { $ifNull: ["$user.lastName", ""] }
          ]
        },
        email: "$user.email",
        totalSellAmount: 1,
        totalEarnedPoints: 1,
        totalRedeemedPoints: 1,
        totalTransactions: 1,
      },
    },
    {
      $sort: { totalSellAmount: -1 }, // top customers first
    },
    { $skip: skip },
    { $limit: limit },
  ];

  const data = await Sell.aggregate(pipeline);

  // ===============================
  // 🔥 Total Count (for pagination)
  // ===============================
  const totalResult = await Sell.aggregate([
    {
      $match: {
        merchantId: new Types.ObjectId(merchantId),
        status: "completed",
      },
    },
    { $group: { _id: "$userId" } },
    { $count: "total" },
  ]);

  const total = totalResult[0]?.total || 0;

  return {
    data,
    pagination: {
      total,
      limit,
      page,
      totalPage: Math.ceil(total / limit),
    },
  };
};

export const AdminMerchantService = {
  getAllMerchants,
  getSingleMerchant,
  updateMerchant,
  deleteMerchant,
  updateMerchantStatus,
  updateMerchantApproveStatus,
  getNearbyMerchants,
  getMerchantCustomerStats,
};
