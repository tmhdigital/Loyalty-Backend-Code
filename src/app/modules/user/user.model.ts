import { model, Schema } from "mongoose";
import {
  APPROVE_STATUS,
  SUBSCRIPTION_STATUS,
  USER_REPORT,
  USER_ROLES,
  USER_STATUS,
} from "../../../enums/user";
import { IUser, UserModal } from "./user.interface";
import bcrypt from "bcrypt";
import config from "../../../config";
import mongoose from "mongoose";

const isValidSocketId = (id: string) => {
  if (typeof id !== "string") return false;
  if (id.length < 5 || id.length > 100) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
};

const userSchema = new Schema<IUser, UserModal>(
  {
    customUserId: {
      type: String,
      index: true,
      unique: true,
      required: false,
    },

    merchantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },

    firstName: { type: String, required: true },
    lastName: { type: String, required: false },

    businessName: { type: String, required: false },
    appId: { type: String, required: false },

    sessionId: {
      type: String,
      default: null,
      index: true,
    },
    fcmToken: { type: String },

    referenceId: {
      type: String,
      unique: true,
      required: false,
    },

    referredInfo: {
      _id: false,
      type: {
        referredId: { type: String },
        referredBy: { type: String },
        referredUserId: { type: String },
      },
    },

    salesRep: { type: String },

    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.USER,
      required: true,
    },

    email: {
      type: String,
      lowercase: true,
    },

    phone: {
      type: String,
    },

    password: {
      type: String,
      select: 0,
    },

    googleId: { type: String },
    appleId: { type: String },

    authProviders: {
      type: [String],
      enum: ["local", "google", "apple"],
      default: ["local"],
    },

    country: { type: String },
    website: { type: String },
    city: { type: String },
    service: { type: String },
    about: { type: String },

    profile: {
      type: String,
      default:
        "https://res.cloudinary.com/dzo4husae/image/upload/v1733459922/zfyfbvwgfgshmahyvfyk.png",
    },

    documentVerified: {
      type: [String],
      default: null,
    },

    photo: { type: String, default: null },
    address: { type: String },

    verified: { type: Boolean, default: false },

    status: {
      type: String,
      enum: Object.values(USER_STATUS),
      default: USER_STATUS.ACTIVE,
    },

    approveStatus: {
      type: String,
      enum: Object.values(APPROVE_STATUS),
    },

    lastStatusChanged: { type: Date },

    userReport: {
      type: String,
      enum: Object.values(USER_REPORT),
      default: USER_REPORT.NO_REPORT,
    },

    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },

    subscription: {
      type: String,
      default: SUBSCRIPTION_STATUS.INACTIVE,
      enum: Object.values(SUBSCRIPTION_STATUS),
    },

    isUserWaiting: { type: Boolean, default: false },

    paymentStatus: {
      type: String,
      enum: ["paid", "unpaid", "expired"],
      default: "unpaid",
    },

    authentication: {
      type: {
        isResetPassword: { type: Boolean, default: false },
        emailOTP: {
          code: { type: Number, default: null },
          expireAt: { type: Date, default: null },
        },
        phoneOTP: {
          code: { type: Number, default: null },
          expireAt: { type: Date, default: null },
        },
      },
      select: 0,
    },

    accountInformation: {
      status: { type: Boolean, default: false },
      stripeAccountId: { type: String },
      externalAccountId: { type: String },
      currency: { type: String },
    },

    preferences: [{ type: String }],

    lastActive: { type: Date, default: Date.now },

    // ✅ FIXED SOCKET IDS WITH VALIDATION
    socketIds: {
      type: [
        {
          type: String,
          validate: {
            validator: isValidSocketId,
            message: "Invalid socketId format",
          },
        },
      ],
      default: [],
    },

    points: { type: Number, default: 0 },
    redeem: { type: Number, default: 0 },
    totalVisits: { type: Number, default: 0 },

    hasViewedReferral: { type: Boolean, default: false },

    // Users this account has already been paid a referral bonus for.
    // This was being written to by the referral logic but was NEVER declared in
    // the schema, so mongoose (strict mode) silently dropped every write and the
    // "don't pay the same bonus twice" guard never actually worked.
    referralBonusGivenFor: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },

    notificationSettings: {
      promotionalEmails: { type: Boolean, default: true },
      appNotifications: { type: Boolean, default: true },
      smsNotifications: { type: Boolean, default: true },
      referralNotifications: { type: Boolean, default: true },
      subscriptionNotifications: { type: Boolean, default: true },
      pushNotifications: { type: Boolean, default: true },
    },

    isRootMerchant: { type: Boolean, default: false },
    isSubMerchant: { type: Boolean, default: false },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    previousPasswords: [
      {
        hash: String,
        changedAt: Date,
      },
    ],

    pages: [String],
  },
  { timestamps: true }
);

// indexes
userSchema.index({ location: "2dsphere" });

userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $exists: true, $ne: null } } }
);

userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $exists: true, $ne: null } } }
);

userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $exists: true } } }
);

userSchema.index(
  { appleId: 1 },
  { unique: true, partialFilterExpression: { appleId: { $exists: true } } }
);

// virtual id
userSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

// pre validate
userSchema.pre("validate", function (next) {
  if (!this.email && !this.phone) {
    return next(new Error("Either email or phone is required"));
  }
  next();
});

// password hash
userSchema.pre("save", async function (this: any, next) {
  if (this.isModified("password") && this.password) {
    this.password = await bcrypt.hash(
      this.password,
      Number(config.bcrypt_salt_rounds)
    );
  }
  next();
});

// statics
userSchema.statics.isExistUserById = async (id: string) => {
  return await User.findById(id);
};

userSchema.statics.isExistUserByEmail = async (email: string) => {
  return await User.findOne({ email });
};

userSchema.statics.isExistUserByPhone = async (phone: string) => {
  return await User.findOne({ phone });
};

userSchema.statics.isAccountCreated = async (id: string) => {
  const user: any = await User.findById(id);
  return user?.accountInformation?.status;
};

userSchema.statics.isMatchPassword = async (
  password: string,
  hashPassword: string
): Promise<boolean> => {
  return await bcrypt.compare(password, hashPassword);
};

export const User = model<IUser, UserModal>("User", userSchema);