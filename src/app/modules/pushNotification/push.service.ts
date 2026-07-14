import { Push } from "./push.model";
import { IPushPayload} from "./push.interface";

import { User } from "../user/user.model";
import admin from "../../../config/firebase";
import { DigitalCard } from "../customer/digitalCard/digitalCard.model";
import { Types } from "mongoose";
import { sendNotification } from "../../../helpers/notificationsHelper";
import { NotificationType } from "../notification/notification.model";
import { Sell } from "../merchant/merchantSellManagement/merchantSellManagement.model";
import { MerchantCustomer } from "../merchant/merchantCustomer/merchantCustomer.model";


// Send push (existing)


const sendNotificationToAllUsers = async (
  payload: IPushPayload,
  adminId: string
) => {
  const {
    sendType,
    title,
    body,
    country,
    tier,
    subscriptionType,
    status,
    city,
  } = payload;

  try {



    // 1️⃣ Fetch all users who have fcmToken
    const allUsersWithToken = await User.find({
      fcmToken: { $exists: true, $ne: null },
    }).select("fcmToken _id role subscription status city country tier");

   

    // Check duplicate token in DB
    const tokenMap: Record<string, number> = {};

    allUsersWithToken.forEach((u: any) => {
      if (!u.fcmToken) return;
      tokenMap[u.fcmToken] = (tokenMap[u.fcmToken] || 0) + 1;
    });



  
    // 2️⃣ Build filter
    const userFilter: any = {
      fcmToken: { $exists: true, $ne: null },
    };

    if (sendType === "MERCHANT") userFilter.role = "MERCHANT";
    else if (sendType === "USER") userFilter.role = "USER";

    if (city && (sendType === "MERCHANT" || sendType === "USER")) {
      userFilter.city = {
        $regex: `^${city}$`,
        $options: "i",
      };
    }

    if (country) {
      userFilter.country = {
        $regex: `^${country}$`,
        $options: "i",
      };
    }

    if (tier) userFilter.tier = tier.toUpperCase();

    if (subscriptionType) {
      userFilter.subscription = {
        $regex: `^${subscriptionType}$`,
        $options: "i",
      };
    }

    if (status) {
      userFilter.status = {
        $regex: `^${status}$`,
        $options: "i",
      };
    }

    // 3️⃣ Fetch users after filter
    const filteredUsers = await User.find(userFilter).select(
      "_id firstName lastName fcmToken"
    );

    const tokenSet = new Set<string>();
    const userIds: Types.ObjectId[] = [];

    filteredUsers.forEach((u: any) => {
      if (u.fcmToken) {
        tokenSet.add(u.fcmToken);
        userIds.push(u._id);
      }
    });

    const tokens = Array.from(tokenSet);
    // Firebase payload
    const message = {
      notification: {
        title,
        body,
      },
      tokens,
    };



    const response = await admin
      .messaging()
      .sendEachForMulticast(message);



    await sendNotification({
      userIds,
      title,
      body,
      type: NotificationType.SYSTEM,
      metadata: {
        sentBy: adminId,
      },
      channel: {
        socket: true,
        push: true,
      },
    });



    const successfulTokens: string[] = [];
    const failedTokens: string[] = [];

    response.responses.forEach((resp, idx) => {
      if (resp.success) {
        successfulTokens.push(tokens[idx]);
      } else {
        failedTokens.push(tokens[idx]);

      }
    });



    return {
      sentCount: response.successCount,
      failedCount: response.failureCount,
      successfulTokens,
      failedTokens,
    };
  } catch  {
    throw new Error("Failed to send push notification");
  }
};




const sendMerchantPromotion = async (payload: any, merchantId: string) => {
  const {
    title,
    message,
    image,
    target,
    filters,
    state,
    country,
    city,
    tier,
    subscriptionType,
  } = payload;



  let users: any[] = [];
  const allCustomer = filters?.segment === "all_customer";

  // ================= FETCH USERS =================
  if (allCustomer) {
    const cards = await DigitalCard.find({ merchantId })
      .populate("userId", "fcmToken location createdAt isVIP")
      .select("userId availablePoints")
      .lean();

    const userIds = cards.map((c: any) => c.userId?._id).filter(Boolean);

    const sells = await Sell.find({
      merchantId,
      userId: { $in: userIds },
      status: "completed",
    }).lean();

    const sellMap: Record<string, any[]> = {};
    sells.forEach((sell: any) => {
      const uid = sell.userId.toString();
      if (!sellMap[uid]) sellMap[uid] = [];
      sellMap[uid].push(sell);
    });

    const now = new Date();
    const last6Months = new Date(now.getTime() - 6 * 30 * 24 * 60 * 60 * 1000);
    const avgSpend = 1000;

    users = cards
      .map((c: any) => {
        const user = c.userId;
        if (!user) return null;

        const userId = user._id.toString();
        const userSells = sellMap[userId] || [];

        const totalSpend = userSells.reduce(
          (sum, s) => sum + (s.discountedBill || 0),
          0
        );

        const last6MonthsPurchases = userSells.filter(
          (s) => new Date(s.createdAt) >= last6Months
        ).length;

        let segment = "new_customer";
        if (last6MonthsPurchases >= 20 || totalSpend >= 3 * avgSpend)
          segment = "vip_customer";
        else if (last6MonthsPurchases >= 5 || totalSpend >= 1.5 * avgSpend)
          segment = "loyal_customer";
        else if (userSells.length >= 2)
          segment = "returning_customer";

        return {
          userId: user._id,
          fcmToken: user.fcmToken,
          location: user.location,
          availablePoints: c.availablePoints ?? 0,
          segment,
        };
      })
      .filter(Boolean);
  } else {
    const merchantCustomers = await MerchantCustomer.find({
      merchantId,
      segment: filters.segment,
    })
      .populate("customerId", "fcmToken location createdAt isVIP")
      .select("customerId points segment")
      .lean();

    users = merchantCustomers
      .map((mc: any) => {
        if (!mc.customerId) return null;

        return {
          userId: mc.customerId._id,
          fcmToken: mc.customerId.fcmToken,
          location: mc.customerId.location,
          availablePoints: mc.points ?? 0,
          segment: mc.segment,
        };
      })
      .filter(Boolean);
  }

  // ================= FILTER =================
  const merchantLocation = filters?.merchantLocation;

  const filtered = users.filter((u) => {
    if (!u.fcmToken) {
      return false;
    }

    if (
      target?.type === "points" &&
      filters?.minPoints !== undefined &&
      u.availablePoints < filters.minPoints
    ) {
      return false;
    }

    if (
      typeof filters?.radius === "number" &&
      merchantLocation?.coordinates &&
      u.location?.coordinates
    ) {
      const [lng1, lat1] = u.location.coordinates;
      const [lng2, lat2] = merchantLocation.coordinates;

      const distance = getDistanceFromLatLonInKm(
        lat1,
        lng1,
        lat2,
        lng2
      );

      if (distance > filters.radius) return false;
    }

    return true;
  });

  // ================= 🔥 FIX 1: REMOVE DUPLICATE USERS =================
  const userMap = new Map<string, any>();

  filtered.forEach((u) => {
    const key = u.userId.toString();
    if (!userMap.has(key)) {
      userMap.set(key, u);
    }
  });

  const uniqueUsers = Array.from(userMap.values());

  // ================= 🔥 FIX 2: REMOVE DUPLICATE TOKENS =================
  const tokenMap = new Map<string, any>();

  uniqueUsers.forEach((u) => {
    if (u.fcmToken) {
      tokenMap.set(u.fcmToken, u);
    }
  });

  const finalUsers = Array.from(tokenMap.values());

  const tokens = finalUsers.map((u) => u.fcmToken);
  const finalUserIds = finalUsers.map((u) => u.userId);

  

  if (tokens.length === 0) {
    return { sentCount: 0, failedCount: 0, message: "No users matched" };
  }

  // ================= FIREBASE =================
  const firebaseMessage = {
    notification: {
      title,
      body: message,
      image,
    },
    data: {
      type: "promotion",
      merchantId: merchantId.toString(),
    },
    tokens,
  };

  const response = await admin.messaging().sendEachForMulticast(firebaseMessage);

  // ================= SOCKET =================
  await sendNotification({
    userIds: finalUserIds,
    title,
    body: message,
    type: NotificationType.PROMOTION,
    metadata: { merchantId },
    attachments: image ? [image] : [],
    channel: { socket: true, push: false },
  });

  // ================= DB =================
  const pushDoc = await Push.create({
    title,
    body: message,
    state,
    country,
    city,
    tier,
    subscriptionType,
    status: "sent",
    createdBy: merchantId,
    sentCount: response.successCount,
    failedCount: response.failureCount,
    mediaUrl: image,
  });



  return {
    sentCount: response.successCount,
    failedCount: response.failureCount,
    dbRecord: pushDoc,
  };
};

function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}






export const PushService = {
  sendNotificationToAllUsers,
  sendMerchantPromotion
  // getAllPushesFromDB,
};
