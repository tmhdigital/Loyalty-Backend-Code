import mongoose from "mongoose";
import Referral from "./referral.model";

import { User } from "../user/user.model";

import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";

const getMyReferredUser = async (userId: string) => {

      // ✅ Mark referral page as viewed
 await User.updateOne(
  { _id: userId, hasViewedReferral: false },  
  { $set: { hasViewedReferral: true } }
);
    // 1. Get current user's location
    const currentUser = await User.findById(userId).select("location referenceId points");
    if (!currentUser) throw new ApiError(StatusCodes.BAD_REQUEST, "User not found");

    const currentLocation = currentUser?.location?.coordinates;

    // 2. Aggregate referred users with points & distance
    const referrals = await Referral.aggregate([
        { $match: { referrer: new mongoose.Types.ObjectId(userId) } },

        // Lookup referred user details
        {
            $lookup: {
                from: "users",
                localField: "referredUser",
                foreignField: "_id",
                as: "user",
            },
        },
        { $unwind: "$user" },

        // Sum points earned from this referral
       {
        $lookup: {
            from: "pointtransactions",
            let: { referralId: "$_id" },
            pipeline: [
            {
                $match: {
                $expr: {
                    $and: [
                    { $eq: ["$referral", "$$referralId"] },
                    { $eq: ["$type", "EARN"] }
                    ]
                }
                }
            },
            {
                $group: {
                _id: null,
                totalPoints: { $sum: "$points" }
                }
            }
            ],
            as: "points"
        }
        }
        ,
        {
            $addFields: {
                pointsEarned: { $ifNull: [{ $arrayElemAt: ["$points.totalPoints", 0] }, 0] },
            },
        },

        // Calculate distance if current user has location
        {
            $addFields: {
                distance: currentLocation
                    ? {
                        $let: {
                            vars: { coords: "$user.location.coordinates" },
                            in: {
                                $round: [
                                    {
                                        $multiply: [
                                            {
                                                $acos: {
                                                    $add: [
                                                        {
                                                            $multiply: [
                                                                { $sin: { $degreesToRadians: { $arrayElemAt: ["$$coords", 1] } } },
                                                                { $sin: { $degreesToRadians: currentLocation[1] } },
                                                            ],
                                                        },
                                                        {
                                                            $multiply: [
                                                                { $cos: { $degreesToRadians: { $arrayElemAt: ["$$coords", 1] } } },
                                                                { $cos: { $degreesToRadians: currentLocation[1] } },
                                                                {
                                                                    $cos: {
                                                                        $subtract: [
                                                                            { $degreesToRadians: { $arrayElemAt: ["$$coords", 0] } },
                                                                            { $degreesToRadians: currentLocation[0] },
                                                                        ],
                                                                    },
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            },
                                            6371,
                                        ],
                                    },
                                    2,
                                ],
                            },
                        },
                    }
                    : null,
            },
        },

        // Project only required fields
        {
            $project: {
                _id: 1,
                pointsEarned: 1,
                // Whether the referral has actually paid out yet. A referred user
                // who has signed up but not subscribed shows completed: false and
                // pointsEarned: 0 — that is expected, not a bug.
                completed: 1,
                distance: 1,
                "user._id": 1,
                "user.firstName": 1,
                "user.lastName": 1,
                "user.profile": 1,
                "user.address": 1,
                "user.status": 1,
            },
        },
    ]);

    // 3. Totals
    const totalReferrals = referrals.length;
    const totalPoints = currentUser.points;
    const totalJoin = referrals.filter(r => r.user).length;
    const myReferenceId = currentUser.referenceId
    return { referrals, totalReferrals, totalPoints, totalJoin, myReferenceId };
};


const verifyReferral = async (referralId: string) => {


    const referredUser = await User.findOne({ referenceId: referralId });
    if (!referredUser) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Referred Id Invalid!");
    }

    return {
        referredUserName: `${referredUser.firstName} ${referredUser.lastName ?? ""}`.trim(),

    };
};
export const ReferralService = { getMyReferredUser, verifyReferral };