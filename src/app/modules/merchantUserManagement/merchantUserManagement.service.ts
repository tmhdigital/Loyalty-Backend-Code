// আগের function

import { USER_ROLES, USER_STATUS } from "../../../enums/user";
import ApiError from "../../../errors/ApiErrors";
import { emailHelper } from "../../../helpers/emailHelper";
import { emailTemplate } from "../../../shared/emailTemplate";
import QueryBuilder from "../../../utils/queryBuilder";
import { IUser } from "../user/user.interface";
import { User } from "../user/user.model";
import { generateCustomUserId } from "../user/user.utils";



const ALLOWED_MERCHANT_ROLES = [
  USER_ROLES.ADMIN_MERCHANT,
  USER_ROLES.VIEW_MERCHANT,
];

const createUserToDB = async (
  payload: Partial<IUser>,
  loggedInUser: any
) => {


  // 🔐 Only Merchant or Admin Merchant can create users
  if (loggedInUser.role !== USER_ROLES.MERCHANT && loggedInUser.role !== USER_ROLES.ADMIN_MERCHANT) {
    throw new ApiError(403, "Only merchant or admin merchant can create users");
  }

  // 🔒 Ownership (main merchant set করা)
  if (loggedInUser.role === USER_ROLES.MERCHANT) {
    // মূল Merchant
    payload.merchantId = loggedInUser._id;
  } else if (loggedInUser.role === USER_ROLES.ADMIN_MERCHANT) {
    // Admin Merchant হলে, মূল Merchant কে assign
    payload.merchantId = loggedInUser.merchantId;
  }

  payload.createdBy = loggedInUser._id;
  payload.isSubMerchant = true;



  // 🔒 Role validation
  if (payload.role) {
    if (!ALLOWED_MERCHANT_ROLES.includes(payload.role as USER_ROLES)) {

      throw new ApiError(
        400,
        "Merchant can only create ADMIN_MERCHANT or VIEW_MERCHANT users"
      );
    }
  } else {
    payload.role = USER_ROLES.VIEW_MERCHANT;
  }


  // 🔒 Default values
  payload.status = USER_STATUS.ACTIVE;
  payload.verified = true;
  payload.isRootMerchant = false;


  // ✅ Generate customUserId
  payload.customUserId = await generateCustomUserId(USER_ROLES.MERCHANT);


  // ✅ Generate referenceId
  if (!payload.referenceId) {
    payload.referenceId = `REF-${Math.floor(10000 + Math.random() * 90000)}`;
  }


  // 📝 Fetch merchant info from DB and auto-populate fields
  const merchantFromDB = await User.findById(payload.merchantId).lean();
  if (!merchantFromDB) {
    throw new ApiError(404, "Merchant not found in database");
  }

  const infoFields = [
    "address",
    "businessName",
    "city",
    "country",
    "service",
    "about",
    "website",
    "photo",
    "profile",
  ];

  infoFields.forEach((field) => {
    if ((merchantFromDB as any)[field] !== undefined) {
      (payload as any)[field] = (merchantFromDB as any)[field];
    }
  });

  


  // 🔍 Check duplicate email or phone
  if (payload.email || payload.phone) {
    const existingUser = await User.findOne({
      $or: [
        { email: payload.email },
        { phone: payload.phone }
      ]
    });

    if (existingUser) {
      if (existingUser.email === payload.email) {
        throw new ApiError(400, "Email already exists");
      }
      if (existingUser.phone === payload.phone) {
        throw new ApiError(400, "Phone number already exists");
      }
    }
  }

  const user = await User.create(payload);


  if (user.email) {
   emailHelper.sendEmail(
    emailTemplate.createAccountNotification({
      email: user.email,
      name: user.firstName || "User",
    })
  );
}

  return user.toObject();
};
// ---------------- Get Users By Merchant ----------------
const getUsersByMerchant = async (loggedInUser: any, query: Record<string, any>) => {
  const mainMerchantId =
    loggedInUser.role === USER_ROLES.MERCHANT
      ? loggedInUser._id
      : loggedInUser.merchantId; // যদি admin হয়, তার main merchant

  if (!mainMerchantId) {
    throw new ApiError(400, "Invalid logged in user");
  }

  // এখন query: merchantId = mainMerchantId
  const queryBuilder = new QueryBuilder(
    User.find({ merchantId: mainMerchantId }).lean(),
    query
  );

  queryBuilder
    .search(['firstName', 'email']) // name field বদলে firstName
    .filter()
    .sort()
    .fields()
    .paginate();

  const users = await queryBuilder.modelQuery;
  const paginationInfo = await queryBuilder.getPaginationInfo();

  return { users, paginationInfo };
};

// ---------------- Get Single User ----------------
const getSingleUser = async (userId: string, loggedInUser: any) => {
  const creatorId = loggedInUser.id || loggedInUser._id;

  if (!creatorId) {
    throw new ApiError(400, "Invalid logged in user");
  }

  // 🔥 Only fetch user created by this merchant
  const user = await User.findOne({
    _id: userId,
    createdBy: creatorId,
  }).lean();

  if (!user) {
    throw new ApiError(404, "User not found or not authorized");
  }

  return user;
};

// ---------------- Update User ----------------
const updateUser = async (
  userId: string,
  payload: Partial<IUser>,
  loggedInUser: any
) => {
  const creatorId = loggedInUser.id || loggedInUser._id;

  if (!creatorId) {
    throw new ApiError(400, "Invalid logged in user");
  }

  // 🔒 Prevent changing ownership
  delete payload.createdBy;
  delete payload.merchantId;

  // 🔒 Role validation
  if (payload.role && !ALLOWED_MERCHANT_ROLES.includes(payload.role as USER_ROLES)) {
    throw new ApiError(
      400,
      "Merchant can only assign ADMIN_MERCHANT or VIEW_MERCHANT roles"
    );
  }

  // 🔒 Find user created by this merchant
  const filter = { _id: userId, createdBy: creatorId };

  const updatedUser = await User.findOneAndUpdate(filter, payload, { new: true }).lean();

  if (!updatedUser) {
    throw new ApiError(404, "User not found or not authorized");
  }

  return updatedUser;
};

// ---------------- Delete User ----------------
const deleteUser = async (userId: string, loggedInUser: any) => {


  // 1️⃣ Initialize filter
  const filter: any = { _id: userId };

  // 2️⃣ MERCHANT role হলে merchantId fetch
  let merchantId: string | null = null;
  if (loggedInUser.role === USER_ROLES.MERCHANT) {
    const merchant = await User.findById(loggedInUser._id).select("merchantId");
    merchantId = merchant?.merchantId?.toString() || null;


    if (!merchantId) {
      console.warn(
        "⚠️ MERCHANT user has no merchantId, cannot delete other users safely"
      );
    } else {
      filter.merchantId = merchantId;
     
    }
  }



  // 3️⃣ Delete user
  const deleted = await User.findOneAndDelete(filter);

  if (!deleted) {
  
    throw new ApiError(404, "User not found or not authorized");
  }

  return true;
};



// ---------------- Toggle Active/Inactive ----------------
const toggleUserStatus = async (userId: string, loggedInUser: any) => {
  const creatorId = loggedInUser.id || loggedInUser._id;

  if (!creatorId) {
    throw new ApiError(400, "Invalid logged in user");
  }

  // 🔒 Only toggle users created by this merchant
  const user = await User.findOne({ _id: userId, createdBy: creatorId });

  if (!user) {
    throw new ApiError(404, "User not found or not authorized");
  }

  // 🔄 Toggle status
  user.status = user.status === USER_STATUS.ACTIVE
    ? USER_STATUS.INACTIVE
    : USER_STATUS.ACTIVE;

  await user.save();

  return { id: user._id, status: user.status };
};



export const UserService = {
    createUserToDB,
    getUsersByMerchant,
    getSingleUser,
    updateUser,
    deleteUser,
    toggleUserStatus,
};