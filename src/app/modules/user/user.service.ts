import { APPROVE_STATUS, USER_ROLES, USER_STATUS } from "../../../enums/user";
import { CreateUserPayload, IUser } from "./user.interface";
import { JwtPayload } from "jsonwebtoken";
import { User } from "./user.model";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import generateOTP from "../../../utils/generateOTP";
import { emailHelper } from "../../../helpers/emailHelper";
import { emailTemplate } from "../../../shared/emailTemplate";

import unlinkFile from "../../../shared/unlinkFile";


import { Subscription } from "../subscription/subscription.model";
// import { IPackage } from "../corePackage/corePackage.interface";
import { DigitalCard, DigitalCardPromotion } from "../customer/digitalCard/digitalCard.model";

import { createUniqueReferralId } from "../../../utils/generateReferralId";
// import { sendOtp } from "../../../config/m3sms";
import { sendOtp } from "../../../config/veevoTechOtp";
import { generateCustomUserId } from "./user.utils";
import Referral from "../referral/referral.model";
import { sendNotification } from "../../../helpers/notificationsHelper";
import { NotificationType } from "../notification/notification.model";
import { logger } from "../../../shared/logger";




// interface IPackageWithId extends IPackage {
//   _id: string;
//   isFreeTrial?: boolean;
// }

const createAdminToDB = async (payload: any): Promise<IUser> => {
  // check admin is exist or not;
  const isExistAdmin = await User.findOne({ email: payload.email });
  if (isExistAdmin) {
    throw new ApiError(StatusCodes.CONFLICT, "This Email already taken");
  }
  // create admin data
  const referenceId = await createUniqueReferralId();
  const adminData = {
    ...payload,
    referenceId,
  };
  // create admin to db
  const createAdmin = await User.create(adminData);
  if (!createAdmin) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to create Admin");
  } else {
    await User.findByIdAndUpdate(
      { _id: createAdmin?._id },
      { verified: true },
      { new: true }
    );
  }

  return createAdmin;
};

const createUserToDB = async (payload: CreateUserPayload): Promise<IUser> => {
  // 1️⃣ Check if user exists
  const isExitByEmail = await User.isExistUserByEmail(payload.email as string);
  const isExitByPhone = await User.isExistUserByPhone(payload.phone as string);

  // ✅ If verified user exists → throw error (same as old logic)
  if ((isExitByEmail && isExitByEmail.verified) || (isExitByPhone && isExitByPhone.verified)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User Already Exist");
  }

  let user: IUser | null = null;

  // 2️⃣ Update existing user
  if (isExitByEmail || isExitByPhone) {
    const existingUser = isExitByEmail || isExitByPhone;
    const userDoc = await User.findById(existingUser!._id);
    if (!userDoc) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to update existing user");
    }
    Object.assign(userDoc, payload); // triggers isModified('password') correctly
    user = await userDoc.save();
  } else {
    // 3️⃣ Create new user
    const referenceId = await createUniqueReferralId();
    const customUserId = await generateCustomUserId(payload.role as string);

    const userData = {
      ...payload,
      referenceId,
      customUserId,
      status:
        payload.role === USER_ROLES.MERCHANT
          ? USER_STATUS.INACTIVE
          : USER_STATUS.ACTIVE,
      ...(payload.role === USER_ROLES.MERCHANT && {
        approveStatus: APPROVE_STATUS.PENDING,
      }),
    };

    user = await User.create(userData);
    if (!user) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to create user");
    }
  }

  // 4️⃣ Handle referral if exists
  if (payload?.referredId && !user.referredInfo) {
    const referrer = await User.findOne({ referenceId: payload.referredId });
    if (!referrer) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Referred Id Invalid!");
    }

    const referredInfo = {
      referredId: payload.referredId,
      referredBy: `${referrer.firstName} ${referrer.lastName || ""}`,
      referredUserId: referrer._id, // ✅ ObjectId stored for referral logic
    };

    await User.findByIdAndUpdate(user._id, { $set: { referredInfo } });

    await Referral.create({
      referrer: referrer._id,
      referredUser: user._id,
    });
  }

  // 5️⃣ Generate OTP
  const otp = generateOTP();
  const otpPayload = {
    code: otp,
    expireAt: new Date(Date.now() + 3 * 60000), // 3 min
  };

  const authUpdate: Record<string, unknown> = {};
  if (user.email) authUpdate["authentication.emailOTP"] = otpPayload;
  if (user.phone) authUpdate["authentication.phoneOTP"] = otpPayload;

  if (Object.keys(authUpdate).length > 0) {
    await User.findByIdAndUpdate(user._id, { $set: authUpdate });
  }

  // 7️⃣ Send OTP to email in the BACKGROUND.
  // Ye jaan boojh kar await NAHI kiya. Email/SMTP slow ya block ho to bhi
  // signup response foran chala jaye. Warna app 60s baad "No Internet" dikhati hai.
  if (user.email) {
    const template = emailTemplate.createAccount({
      name: user.firstName || "User",
      otp,
      email: user.email,
    });
    emailHelper
      .sendEmail(template)
      .catch((error) => logger.error("Failed to send signup email OTP", error));
  }

  // 8️⃣ Send OTP via VeevoTech API for phone in the BACKGROUND (await nahi).
  if (user.phone) {
    sendOtp(user.phone, otp.toString()).catch((error) =>
      logger.error("Failed to send signup SMS OTP", error)
    );
  }

  // 8️⃣ Notify Super Admin
  const superAdmin = await User.findOne({ role: USER_ROLES.SUPER_ADMIN }).select("_id");
  if (superAdmin) {
    sendNotification({
      userIds: [superAdmin._id.toString()],
      title: "A new user has registered/updated",
      body: `User ${user.firstName} has registered or updated with the role ${user.role}.`,
      type: NotificationType.SYSTEM,
    });
  }

  return user;
};





const getUserProfileFromDB = async (
  user: JwtPayload
): Promise<
  Partial<IUser> & {
    subscriptions: any[];
    totalSubscriptions: number;
    hasUsedFreePlan: boolean;
  }
> => {
  const { _id } = user;

  const isExistUser: any = await User.findById(_id).lean();
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  const subscriptions: any[] = await Subscription.find({ user: _id })
    .populate({ path: "package", select: "title price duration isFreeTrial" })
    .lean();

  const formattedSubscriptions = subscriptions.map((sub) => ({
    subscriptionId: sub._id,
    packageId: sub.package?._id || null,
    packageTitle: sub.package?.title || "Deleted Package",
    price: sub.price,
    duration: sub.package?.duration || "N/A",
    startDate: sub.currentPeriodStart,
    endDate: sub.currentPeriodEnd,
    status: sub.status,
    trxId: sub.trxId,
    subscriptionStripeId: sub.subscriptionId,
  }));

  // 🔥 Check free plan usage
  const hasUsedFreePlan = subscriptions.some(
    (sub) => sub.package?.isFreeTrial === true
  );

  return {
    ...isExistUser,
    subscriptions: formattedSubscriptions,
    totalSubscriptions: subscriptions.length,
    hasUsedFreePlan, // ✅ NEW FIELD
  };
};


const updateProfileToDB = async (
  user: JwtPayload,
  payload: Partial<IUser>
): Promise<Partial<IUser | null>> => {
  const { _id } = user;

  const isExistUser = await User.isExistUserById(_id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  // unlink old files
  if (payload.profile && isExistUser.profile) {
    unlinkFile(isExistUser.profile);
  }

  if (payload.photo && isExistUser.photo) {
    unlinkFile(isExistUser.photo);
  }

  try {
    const updateDoc = await User.findOneAndUpdate(
      { _id },
      payload,
      {
        new: true,
        runValidators: true,
      }
    );

    return updateDoc;
  } catch (error: any) {
    /* -----------------------------
       🔴 Handle Duplicate Key Error
    ------------------------------*/
    if (error?.code === 11000) {
      const field = Object.keys(error.keyValue || {})[0];

      throw new ApiError(
        StatusCodes.CONFLICT,
        `This ${field} already exists`
      );
    }

    throw error;
  }
};


const getUserOnlineStatusFromDB = async (userId: string) => {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const now = new Date();
  const diffMinutes = (now.getTime() - user.lastActive.getTime()) / 1000 / 60;

  const isOnline = diffMinutes <= 5; // 5 মিনিটের মধ্যে active হলে online

  return {
    userId: user._id.toString(),
    name: user.firstName + " " + user.lastName,
    isOnline,
    lastActive: user.lastActive,
    lastActiveMinutesAgo: Math.floor(diffMinutes),
  };
};



const getUserSummaryCountsFromDB = async (userId: string) => {
  // 1️⃣ Fetch subscriptions with package title
  const subscriptions = await Subscription.find({ user: userId })
    .populate("package", "title")
    .lean();

  const subscriptionTitles = subscriptions
    .map((sub) => (sub.package as any)?.title)
    .filter(Boolean);

  // 2️⃣ Total spent
  const totalSpent = subscriptions.reduce(
    (sum, sub) => sum + (sub.price || 0),
    0
  );

  // 3️⃣ Fetch digital cards once (reuse)
  const digitalCards = await DigitalCard.find({ userId }).lean();

  // 4️⃣ Total digital cards
  const totalDigitalCards = digitalCards.length;

  // 5️⃣ Total promotions via DigitalCardPromotion collection (exclude expired)
  const digitalCardIds = digitalCards.map((c) => c._id);
  const totalPromotions = await DigitalCardPromotion.countDocuments({
    digitalCardId: { $in: digitalCardIds },
    status: { $ne: "expired" },
  });

  return {
    totalSpent,
    totalDigitalCards,
    totalPromotions,
    subscriptionTitles,
  };
};

export const UserService = {
  createUserToDB,
  getUserProfileFromDB,
  updateProfileToDB,
  createAdminToDB,
  getUserOnlineStatusFromDB,
  getUserSummaryCountsFromDB,
};