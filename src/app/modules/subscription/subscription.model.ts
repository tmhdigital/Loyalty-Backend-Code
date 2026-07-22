import { model, Schema } from "mongoose";
import { ISubscription, SubscriptionModel } from "./subscription.interface";


const subscriptionSchema = new Schema<ISubscription, SubscriptionModel>(
  {
    customerId: {
      type: String,
      required: function (this: any) {
    
        return this.source === "online" || this.source === "salesRep";
      },
    },
    price: {
      type: Number,
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    package: {
      type: Schema.Types.ObjectId,
      ref: "Package",
      required: true,
    },
    trxId: {
      type: String,
      required: function (this: any) {
        return this.price > 0;
      },
    },
    subscriptionId: { type: String, unique: true, required: true },
    currentPeriodStart: {
      type: Date,
      required: true,
    },
    currentPeriodEnd: {
      type: Date,
      required: true,
    },
    remaining: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["expired", "active", "cancel"],
      default: "active",
      required: true,
    },
    source: {
      type: String,
      enum: ["online", "salesRep", "free", "manual", "kuickpay"], // ✅ kuickpay added
      default: "online",
    },
  },
  {
    timestamps: true,
  }
);

// User dashboard / history query
subscriptionSchema.index({ user: 1, status: 1 });

// Cron job (EXPIRY CHECK - MOST IMPORTANT)
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });




export const Subscription = model<ISubscription, SubscriptionModel>("Subscription", subscriptionSchema)