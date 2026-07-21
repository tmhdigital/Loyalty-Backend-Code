import { Schema, model, Types } from "mongoose";

export type IKuickpayOrder = {
  orderId: string;
  user: Types.ObjectId;
  package: Types.ObjectId;
  amount: number;
  grossAmount: number;
  taxAmount: number;
  pointsUsed: number;
  status: "pending" | "completed" | "failed";
  transactionId?: string;
  responseCode?: string;
  rawReturn?: Record<string, unknown>;
  rawIpn?: Record<string, unknown>;
  signatureVerified?: boolean;
  signatureVariant?: string;
  activatedVia?: "return" | "ipn" | "app-confirm";
  subscription?: Types.ObjectId;
};

const kuickpayOrderSchema = new Schema<IKuickpayOrder>(
  {
    orderId: { type: String, unique: true, required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    package: { type: Schema.Types.ObjectId, ref: "Package", required: true },
    amount: { type: Number, required: true },
    grossAmount: { type: Number, required: true },
    taxAmount: { type: Number, required: true, default: 0 },
    pointsUsed: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    transactionId: { type: String },
    responseCode: { type: String },
    rawReturn: { type: Schema.Types.Mixed },
    rawIpn: { type: Schema.Types.Mixed },
    signatureVerified: { type: Boolean, default: false },
    signatureVariant: { type: String },
    activatedVia: { type: String, enum: ["return", "ipn", "app-confirm"] },
    subscription: { type: Schema.Types.ObjectId, ref: "Subscription" },
  },
  { timestamps: true }
);

kuickpayOrderSchema.index({ status: 1, createdAt: 1 });
kuickpayOrderSchema.index({ user: 1, createdAt: -1 });

export const KuickpayOrder = model<IKuickpayOrder>(
  "KuickpayOrder",
  kuickpayOrderSchema
);