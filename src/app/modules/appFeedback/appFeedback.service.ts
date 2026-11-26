import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import ApiError from "../../../errors/ApiErrors";
import { AppFeedback } from "./appFeedback.model";
import {
  FEEDBACK_CATEGORY,
  FEEDBACK_PLATFORM,
  FEEDBACK_STATUS,
  IAppFeedback,
} from "./appFeedback.interface";

type CreatePayload = Pick<
  IAppFeedback,
  "rating" | "category" | "comment" | "appVersion" | "platform" | "deviceModel"
>;

const USER_FIELDS = "firstName lastName email phone";

const createFeedback = async (userId: string, payload: CreatePayload) => {
  return AppFeedback.create({
    ...payload,
    userId: new Types.ObjectId(userId),
  });
};

// Only whitelisted string values are used, so no Mongo operators can be injected.
const buildFilter = (query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = {};
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

  const status = str(query.status);
  if (status) {
    if (!Object.values(FEEDBACK_STATUS).includes(status as FEEDBACK_STATUS)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid status filter");
    }
    filter.status = status;
  }

  const category = str(query.category);
  if (category) {
    if (!Object.values(FEEDBACK_CATEGORY).includes(category as FEEDBACK_CATEGORY)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid category filter");
    }
    filter.category = category;
  }

  const platform = str(query.platform);
  if (platform) {
    if (!Object.values(FEEDBACK_PLATFORM).includes(platform as FEEDBACK_PLATFORM)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid platform filter");
    }
    filter.platform = platform;
  }

  const rating = Number(str(query.rating));
  if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
    filter.rating = rating;
  }

  const from = str(query.from) ? new Date(query.from as string) : null;
  const to = str(query.to) ? new Date(query.to as string) : null;
  const range: Record<string, Date> = {};
  if (from && !isNaN(from.getTime())) range.$gte = from;
  if (to && !isNaN(to.getTime())) {
    to.setHours(23, 59, 59, 999);
    range.$lte = to;
  }
  if (Object.keys(range).length) filter.createdAt = range;

  return filter;
};

const getAllFeedback = async (query: Record<string, unknown>) => {
  const filter = buildFilter(query);
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);

  const [feedback, total, summaryAgg] = await Promise.all([
    AppFeedback.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("userId", USER_FIELDS)
      .lean(),
    AppFeedback.countDocuments(filter),
    // Summary cards are over ALL feedback, not the current filter.
    AppFeedback.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          averageRating: { $avg: "$rating" },
          newCount: {
            $sum: { $cond: [{ $eq: ["$status", FEEDBACK_STATUS.NEW] }, 1, 0] },
          },
          bugCount: {
            $sum: { $cond: [{ $eq: ["$category", FEEDBACK_CATEGORY.BUG] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  const s = summaryAgg[0];
  const summary = {
    total: s?.total ?? 0,
    averageRating: s?.averageRating ? Number(s.averageRating.toFixed(1)) : 0,
    newCount: s?.newCount ?? 0,
    bugCount: s?.bugCount ?? 0,
  };

  return {
    data: { feedback, summary },
    pagination: { total, limit, page, totalPage: Math.ceil(total / limit) },
  };
};

const updateFeedback = async (
  id: string,
  payload: Partial<Pick<IAppFeedback, "status" | "adminNote">>
) => {
  const updated = await AppFeedback.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  })
    .populate("userId", USER_FIELDS)
    .lean();

  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Feedback not found");
  }
  return updated;
};

export const AppFeedbackService = {
  createFeedback,
  getAllFeedback,
  updateFeedback,
};
