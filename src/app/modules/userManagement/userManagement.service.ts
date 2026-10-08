import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";

import {
  SUBSCRIPTION_STATUS,
  USER_ROLES,
  USER_STATUS,
} from "../../../enums/user";

import { IUser } from "../user/user.interface";
import { User } from "../user/user.model";
import { generateCustomUserId } from "../user/user.utils";
import { createUniqueReferralId } from "../../../utils/generateReferralId";
import QueryBuilder from "../../../utils/queryBuilder";
import { emailHelper } from "../../../helpers/emailHelper";
import { emailTemplate } from "../../../shared/emailTemplate";




// create user
const createUserToDB = async (payload: IUser, _creator?: any) => {
  if (!payload.email) throw new ApiError(400, "Email is required");
  if (!payload.phone) throw new ApiError(400, "Phone number is required");
  if (!payload.password) throw new ApiError(400, "Password is required");

  // ✅ Email / phone check
  const isEmailExist = await User.isExistUserByEmail(payload.email);
  if (isEmailExist) throw new ApiError(400, "Email already exists");

  const isPhoneExist = await User.isExistUserByPhone(payload.phone);
  if (isPhoneExist) throw new ApiError(400, "Phone already exists");

  const ALLOWED_CREATOR_ROLES = [
    USER_ROLES.ADMIN_SELL,
    USER_ROLES.VIEW_ADMIN,
    USER_ROLES.ADMIN,
    USER_ROLES.ADMIN_REP
  ];

  let role = USER_ROLES.VIEW_ADMIN;
  if (payload.role) {
    if (!ALLOWED_CREATOR_ROLES.includes(payload.role as USER_ROLES)) {
      throw new ApiError(400, "User can only be created with allowed roles");
    }
    role = payload.role as USER_ROLES;
  }

  const referenceId = await createUniqueReferralId();
  const customUserId = await generateCustomUserId(role);

  const userData = {
    ...payload,
    role,
    // merchantId: creator?.role?.startsWith("MERCHANT") ? creator._id : null, // ✅ ObjectId pass
    customUserId,
    referenceId,
    verified: true,
  };

  const result = await User.create(userData);

  // ✅ Send email notification
  if (result.email) {
     emailHelper.sendEmail(
      emailTemplate.createAccountNotification({
        email: result.email,
        name: result.firstName || "User",
      })
    );
  }

  return result;
};


enum APPROVE_STATUS {
  APPROVED = "approved",
  PENDING = "pending",
}


const createMerchantToDB = async (payload: any, creatorUser: any) => {


  // required check
  if (!payload.email) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Email is required");
  }

  if (!payload.phone) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Phone is required");
  }

  if (!payload.password) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is required");
  }

  // uniqueness check
  if (await User.isExistUserByEmail(payload.email)) {
   
    throw new ApiError(StatusCodes.BAD_REQUEST, "Email already exists");
  }

  if (await User.isExistUserByPhone(payload.phone)) {

    throw new ApiError(StatusCodes.BAD_REQUEST, "Phone already exists");
  }

  const referenceId = await createUniqueReferralId();
  const customerId = await generateCustomUserId(USER_ROLES.MERCHANT);



  const merchantData: any = {
    ...payload,

    // system fields
    role: USER_ROLES.MERCHANT,
    status: USER_STATUS.ACTIVE,
    verified: true,

    customUserId: customerId,
    referenceId,

    // ⚠️ IMPORTANT (case sensitive issue check)
    subscription: "active",
    paymentStatus: "paid",

    // merchant specific
    businessName: payload.businessName,
    lastPaymentDate: payload.lastPaymentDate,
    expiryDate: payload.expiryDate,
    tier: payload.tier,
    salesRep: payload.salesRep,
    city: payload.city,
  };


  // ✅ ONLY super_admin auto approve
  if (creatorUser.role === USER_ROLES.SUPER_ADMIN) {
    merchantData.approveStatus = APPROVE_STATUS.APPROVED;

  }

  // 🔍 duplicate check (again)
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

  const result = await User.create(merchantData);



  if (result.email) {


    emailHelper.sendEmail(
      emailTemplate.createAccountNotification({
        email: result.email,
        name: result.firstName || "User",
      })
    );
  }



  return result;
};


// get all users
// Service
const getAllUsersFromDB = async (requestingUserRole: string, query: Record<string, any>) => {
 
  const allowedRoles = ["ADMIN", "ADMIN_SELL", "ADMIN_REP", "SUPER_ADMIN", "MANAGER", "VIEW_ADMIN"];

  if (!allowedRoles.includes(requestingUserRole)) {
    throw new ApiError(403, "Access denied");
  }

  // Base query
  let baseQuery = User.find({ role: { $in: allowedRoles, $ne: "SUPER_ADMIN" } });

  // QueryBuilder instance
  const qb = new QueryBuilder(baseQuery, query)
    .search(["firstName", "lastName", "email", "phone"]) // search
    .filter() // filter
    .sort() // sort
    .paginate() // pagination
    .fields(); // fields select

  // Execute query
  const users = await qb.modelQuery.lean();

  // Pagination info
  const pagination = await qb.getPaginationInfo();

  return { users, pagination };
};


// get single user
const getSingleUserFromDB = async (id: string) => {
  const result = await User.findById(id).select("-password");
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }
  return result;
};

// update user
const updateUserToDB = async (id: string, payload: Partial<IUser>) => {
  const isExist = await User.findById(id);
  if (!isExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  // password কখনো update হবে না
  if (payload.password) {
    delete payload.password;
  }

  const result = await User.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  }).select("-password");

  return result;
};


// delete user
const deleteUserFromDB = async (id: string) => {
  const isExist = await User.findById(id);
  if (!isExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  await User.findByIdAndDelete(id);
  return { deleted: true };
};

// toggle active/inactive
const toggleUserStatusFromDB = async (id: string) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

   // Ensure subscription enum is valid
  if (!user.subscription || !Object.values(SUBSCRIPTION_STATUS).includes(user.subscription as SUBSCRIPTION_STATUS)) {
    user.subscription = SUBSCRIPTION_STATUS.INACTIVE;
  }

  user.status =
    user.status === USER_STATUS.ACTIVE
      ? USER_STATUS.INACTIVE
      : USER_STATUS.ACTIVE;

  await user.save();
  return user;
};



const getAllMerchants = async (query: Record<string, unknown>) => {
  const baseQuery = User.find({ role: USER_ROLES.MERCHANT });

  const allMerchantsQuery = new QueryBuilder(baseQuery, query)
    .search(["firstName", "lastName", "email", "phone"])
    .filter()
    .paginate()
    .sort();

  const allmerchants = await allMerchantsQuery.modelQuery.lean();
  const pagination = await allMerchantsQuery.getPaginationInfo();

  return {
    allmerchants,
    pagination,
  };
};



const getSingleMerchant = async (id: string) => {
  const merchant = await User.findOne({
    _id: id,
    role: USER_ROLES.MERCHANT,
  }).lean();

  if (!merchant) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Merchant not found");
  }

  return merchant;
};


const updateMerchant = async (
  id: string,
  payload: Partial<IUser>
) => {
  const merchant = await User.findOneAndUpdate(
    { _id: id, role: USER_ROLES.MERCHANT },
    payload,
    { new: true }
  ).lean();

  if (!merchant) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Merchant not found");
  }

  return merchant;
};


const deleteMerchant = async (id: string) => {
  const merchant = await User.findOneAndDelete({
    _id: id,
    role: USER_ROLES.MERCHANT,
  });

  if (!merchant) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Merchant not found");
  }

  return true;
};
   

const toggleMerchantStatus = async (id: string) => {
  const merchant = await User.findOne({
    _id: id,
    role: USER_ROLES.MERCHANT,
  });

  if (!merchant) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Merchant not found");
  }

  merchant.status =
    merchant.status === USER_STATUS.ACTIVE
      ? USER_STATUS.INACTIVE
      : USER_STATUS.ACTIVE;

  await merchant.save();

  return {
    id: merchant._id,
    status: merchant.status,
  };
};


export const UserService = {
  createUserToDB,
  createMerchantToDB,
  getAllUsersFromDB,
  getSingleUserFromDB,
  updateUserToDB,
  deleteUserFromDB,
  toggleUserStatusFromDB,
  getSingleMerchant,
  updateMerchant,
  deleteMerchant,
  toggleMerchantStatus,
  getAllMerchants
};
