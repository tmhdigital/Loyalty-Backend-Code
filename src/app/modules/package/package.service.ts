import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { IPackage } from "./package.interface";
import { Package } from "./package.model";
import mongoose from "mongoose";
import stripe from "../../../config/stripe";

import { createSubscriptionProduct } from "../../../helpers/createSubscriptionProductHelper";

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

    // 🔹 Keep isFreeTrial in sync with price on edit too (not just on create)
    if (payload.price !== undefined) {
        payload.isFreeTrial = payload.price === 0;
    }

    // Update Stripe product
    if (payload.title || payload.description) {
        await stripe.products.update(existingPackage.productId, {
            name: payload.title || existingPackage.title,
            description: payload.description || existingPackage.description,
        });
    }

    // Update Stripe price if price changed
    if (payload.price && payload.price !== existingPackage.price) {
        const newPrice = await stripe.prices.create({
            unit_amount: payload.price * 100,
            currency: "usd",
            product: existingPackage.productId,
            recurring: { interval: payload.paymentType?.toLowerCase() === 'monthly' ? 'month' : 'year' },
        });

        payload.priceId = newPrice.id;

        const paymentLink = await stripe.paymentLinks.create({
            line_items: [{ price: newPrice.id, quantity: 1 }]
        });

        payload.paymentLink = paymentLink.url;
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
