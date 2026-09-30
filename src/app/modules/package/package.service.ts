import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { IPackage } from "./package.interface";
import { Package } from "./package.model";
import mongoose from "mongoose";
import stripe from "../../../config/stripe";

import {
  createRecurringPrice,
  createSubscriptionProduct,
  FREE_PLAN_ID,
} from "../../../helpers/createSubscriptionProductHelper";

/**
 * Only one free (price 0) plan may exist, active or inactive; the admin
 * edits and re-activates that one instead of creating another.
 */
const assertNoOtherFreePlan = async (excludeId?: string) => {
  const other = await Package.findOne({
    $or: [{ isFreeTrial: true }, { price: 0 }],
    ...(excludeId && { _id: { $ne: excludeId } }),
  });
  if (other) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `A free plan already exists ("${other.title}"). Only one plan can be free, edit that plan instead.`
    );
  }
};

const createPackageToDB = async (payload: Partial<IPackage>): Promise<IPackage> => {


  // ✅ Check existing package
  const existingPackage = await Package.findOne({
    duration: payload.duration,
    admin: payload.admin,
    status: "Active",
  });


  if (existingPackage) {

    throw new Error("Package already exists");
  }

  // 🔹 If price is 0, mark as free plan
  if (payload.price === 0) {
    await assertNoOtherFreePlan();
    payload.isFreeTrial = true;
  }

  // ✅ Create Stripe Product + Price

  const product = await createSubscriptionProduct({
    title: payload.title!,
    description: payload.description!,
    duration: payload.duration!,
    price: payload.price!,
  });



  // Assign only available fields
  payload.productId = product.productId;
  payload.priceId = product.priceId;


  // Save to DB
  const result = await Package.create(payload as IPackage);



  // Optionally: delete Stripe product if DB save fails
  if (!result) {
  
    await stripe.products.del(product.productId);
  }

  return result;
};


const updatePackageToDB = async (id: string, payload: Partial<IPackage>): Promise<IPackage | null> => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid ID");
    }

    const existingPackage = await Package.findById(id);
    if (!existingPackage) throw new ApiError(StatusCodes.BAD_REQUEST, "Package not found");

    if (payload.duration) {
    const duplicate = await Package.findOne({
        duration: payload.duration,
        admin: existingPackage.admin,
        status: "Active",
        _id: { $ne: id },
    });

    if (duplicate) {
        throw new ApiError(400, `Package already exists for ${payload.duration}`);
    }
    }

    const price = payload.price ?? existingPackage.price;
    const duration = payload.duration ?? existingPackage.duration;
    const isFree = price === 0;
    // Free plans have no Stripe product (productId is the FREE_PLAN placeholder)
    const wasFree = existingPackage.productId === FREE_PLAN_ID;
    const priceChanged =
        price !== existingPackage.price || duration !== existingPackage.duration;

    // 🔹 Keep isFreeTrial in sync with price on edit too (not just on create)
    payload.isFreeTrial = isFree;

    // Becoming free: only allowed if no other plan is free
    if (isFree && !existingPackage.isFreeTrial && existingPackage.price !== 0) {
        await assertNoOtherFreePlan(id);
    }

    if (isFree) {
        // Paid -> free (or still free): nothing in Stripe to update
        payload.productId = FREE_PLAN_ID;
        payload.priceId = FREE_PLAN_ID;
    } else if (wasFree) {
        // Free -> paid: the plan has no Stripe product yet, create one
        const product = await createSubscriptionProduct({
            title: payload.title || existingPackage.title,
            description: payload.description || existingPackage.description,
            duration,
            price,
        });
        payload.productId = product.productId;
        payload.priceId = product.priceId;
    } else {
        // Paid -> paid: sync name/description, new price if amount or duration changed
        if (payload.title || payload.description) {
            await stripe.products.update(existingPackage.productId, {
                name: payload.title || existingPackage.title,
                description: payload.description || existingPackage.description,
            });
        }
        if (priceChanged) {
            payload.priceId = await createRecurringPrice(
                existingPackage.productId,
                price,
                duration
            );
        }
    }

    // Points-discount prices were built from the old price, rebuild on demand
    if (priceChanged || isFree !== wasFree) {
        payload.priceIdWithPoints = {};
    }

    return Package.findByIdAndUpdate(id, payload, { new: true });
};

const getPackageFromDB = async(paymentType?: string): Promise<IPackage[]> => {
    const query: any = { };
    if(paymentType) query.paymentType = paymentType;
    return Package.find(query);
};

const getSinglePackageFromDB = async (id: string): Promise<IPackage | null> => {
    return Package.findById(id).where({ status: "Active" });
};

const getPackageDetailsFromDB = async(id: string): Promise<IPackage | null> => {
    if(!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid ID");
    return Package.findById(id);
};

const deletePackageToDB = async(id: string): Promise<IPackage | null> => {
    if(!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid ID");

    const result = await Package.findByIdAndDelete(id);
    if(!result) throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to delete package");

    return result;
};

const togglePackageStatusInDB = async(id: string): Promise<IPackage | null> => {
    if(!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid ID");
    const existingPackage = await Package.findById(id);
    if(!existingPackage) throw new ApiError(StatusCodes.BAD_REQUEST, "Package not found");
    const newStatus = existingPackage.status === "Active" ? "Inactive" : "Active";
    return Package.findByIdAndUpdate(id, { status: newStatus }, { new: true });
};

const getActivePackagesFromDB = async (): Promise<IPackage[]> => {
    return Package.find({ status: "Active" });
};

export const PackageService = {
    createPackageToDB,
    updatePackageToDB,
    getPackageFromDB,
    getPackageDetailsFromDB,
    deletePackageToDB,
    getSinglePackageFromDB,
    togglePackageStatusInDB,
    getActivePackagesFromDB
};
