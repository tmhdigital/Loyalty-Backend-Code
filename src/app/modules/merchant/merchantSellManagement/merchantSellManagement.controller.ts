import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../../shared/catchAsync";
import sendResponse from "../../../../shared/sendResponse";
import { SellService } from "./merchantSellManagement.service";
import { IUser } from "../../user/user.interface";
import { Types } from "mongoose";
import ExcelJ from "exceljs";
import { USER_ROLES } from "../../../../enums/user";

// 🔹 Demo data fallback


const checkout = catchAsync(async (req: Request, res: Response) => {
  const { digitalCardCode, totalBill, promotionId = [], pointRedeemed = 0 } = req.body;



  if (!req.user) {
    return sendResponse(res, {
      statusCode: StatusCodes.UNAUTHORIZED,
      success: false,
      message: "User not authenticated",
    });
  }

  const user = req.user as IUser;

  if (user.role !== "MERCHANT" && !user.isSubMerchant) {
    return sendResponse(res, {
      statusCode: StatusCodes.FORBIDDEN,
      success: false,
      message: "Only merchant or merchant staff can perform checkout",
    });
  }

  const merchantId = user.isSubMerchant ? user.merchantId : user._id;

  if (!merchantId) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "Merchant ID not found",
    });
  }

  // ✅ always pass as array
  const promotionIdsArray = Array.isArray(promotionId)
    ? promotionId
    : promotionId
    ? [promotionId]
    : [];

  const data = await SellService.checkout(
    merchantId.toString(),
    digitalCardCode,
    totalBill,
    promotionIdsArray,   // ✅ fixed
    pointRedeemed
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Checkout completed successfully",
    data: data,
  });
});






const requestApproval = catchAsync(async (req: Request, res: Response) => {
  const {
    digitalCardCode,
    promotionId = [],
    totalBill = 0,
    pointRedeemed = 0,
  } = req.body;

  if (totalBill < 0 || pointRedeemed < 0) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "totalBill and pointRedeemed cannot be negative",
    });
  }

  if (!req.user) {
    return sendResponse(res, {
      statusCode: StatusCodes.UNAUTHORIZED,
      success: false,
      message: "User not authenticated",
    });
  }

  const user = req.user as IUser;

  if (user.role !== "MERCHANT" && !user.isSubMerchant) {
    return sendResponse(res, {
      statusCode: StatusCodes.FORBIDDEN,
      success: false,
      message: "Only merchant or merchant staff can request approval",
    });
  }

  const merchantId = user.isSubMerchant ? user.merchantId : user._id;

  if (!merchantId) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "Merchant ID not found",
    });
  }

  const data = await SellService.requestApproval({
    merchantId: merchantId.toString(),
    digitalCardCode,
    promotionId,
    totalBill,
    pointRedeemed,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Approval request simulated successfully",
    data,
  });
});



// User → Get Pending Requests
const getPendingRequests = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IUser;

  if (!user._id) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "User ID not found",
    });
  }

  const data = await SellService.getPendingRequests(user._id.toString());

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Pending promotions fetched",
    data: data,
  });
});

const approvePromotion = catchAsync(async (req: Request, res: Response) => {
  const { digitalCardCode, promotionId, sellId } = req.body;
  const user = req.user as IUser;

  if (!user._id) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "User ID not found",
    });
  }

  // Ensure promotionId is an array
  const promotionIds = Array.isArray(promotionId) ? promotionId : [promotionId];

  const data = await SellService.approvePromotion(
    digitalCardCode,
    promotionIds,
    user._id.toString(),
    sellId // optional
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Promotion approved successfully",
    data: data,
  });
});


const approvePromotionreject = catchAsync(
  async (req: Request, res: Response) => {
    const { digitalCardCode, promotionId, sellId } = req.body;
    const user = req.user as IUser;

    if (!user._id) {
      return sendResponse(res, {
        statusCode: StatusCodes.BAD_REQUEST,
        success: false,
        message: "User ID not found",
      });
    }

    const promotionIds = Array.isArray(promotionId) ? promotionId : [promotionId];

    const data = await SellService.approvePromotionReject(
      digitalCardCode,
      promotionIds,
      user._id.toString(),
      sellId // optional
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Promotion rejected successfully",
      data: data,
    });
  }
);


// Controller
const getPointsHistory = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as IUser;
  const { digitalCardId, type } = req.query;

  if (!user._id) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "User ID not found",
    });
  }

  if (!digitalCardId) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "digitalCardId is required",
    });
  }

  const data = await SellService.getPointsHistory(
    digitalCardId.toString(),
    (type as "all" | "earn" | "use") || "all"
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Points transactions fetched successfully",
    data: data,
  });
});


const getUserFullTransactions = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params;

  // 🔥 merchantId from token
  const user = req.user as any;
  const merchantId = user.isSubMerchant ? user.merchantId : user._id;

  const type = (req.query.type as "all" | "earn" | "use") || "all";
  const page = parseInt((req.query.page as string) || "1");
  const limit = parseInt((req.query.limit as string) || "20");

  const data = await SellService.getUserFullTransactions(
    userId,
    merchantId,
    type,
    page,
    limit
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "User transactions fetched successfully",
    data: data.transactions,
  });
});


const getMerchantSales = async (req: Request, res: Response) => {
  try {
    // -----------------------------
    // 0️⃣ Merchant / Sub-Merchant Check
    // -----------------------------
    const user = req.user as {
      _id: string;
      role?: string;
      isSubMerchant?: boolean;
      merchantId?: string;
    };

    if (!user?._id || !Types.ObjectId.isValid(user._id)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized merchant",
      });
    }

    const merchantId = user.isSubMerchant ? user.merchantId : user._id;

    if (!merchantId) {
      return res.status(400).json({
        success: false,
        message: "Merchant ID not found",
      });
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const { transactionData, total } = await SellService.getMerchantSalesFromDB(
      merchantId.toString(),
      req.query
    );

    if (!transactionData || transactionData.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { page: 1, limit: 0, total: 0, totalPage: 0 },
        message: "No sales found for this period",
      });
    }

    // -----------------------------
    // 7️⃣ Response
    // -----------------------------
    // "User" (view-only) dashboard accounts must not see customer contact details
    const data =
      user.role === USER_ROLES.VIEW_MERCHANT
        ? transactionData.map(({ email: _email, phone: _phone, ...rest }: any) => rest)
        : transactionData;

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPage: Math.ceil(total / limit),
      },
    });

  } catch {
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};






const getMerchantCustomersList = async (req: Request, res: Response) => {
  try {
    const user = req.user as any;

    // ✅ Decide merchant ID
    const filterId = user.isSubMerchant ? user.merchantId : user._id;

    if (!filterId || !Types.ObjectId.isValid(filterId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized merchant",
      });
    }

    const merchantId = filterId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const { customers, total } = await SellService.getMerchantCustomersListFromDB(
      merchantId.toString(),
      req.query
    );

    if (!customers.length) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          page: 1,
          limit: 0,
          total: 0,
          totalPage: 0,
        },
      });
    }

    /* -----------------------------
       5️⃣ Response
    ------------------------------*/
    return res.status(200).json({
      success: true,
      data: customers,
      pagination: {
        page,
        limit,
        total,
        totalPage: Math.ceil(total / limit),
      },
    });

  } catch {
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

const getRecentMerchantCustomersList = async (req: Request, res: Response) => {
  try {
    const user = req.user as any;

    // ✅ Merchant / Sub-merchant filter
    const filterId = user.isSubMerchant ? user.merchantId : user._id;

    if (!filterId || !Types.ObjectId.isValid(filterId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized merchant",
      });
    }

    const merchantId = filterId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const { customers, total } = await SellService.getRecentMerchantCustomersListFromDB(
      merchantId.toString(),
      req.query
    );

    /* -----------------------------
       ✅ Response
    ------------------------------*/
    return res.status(200).json({
      success: true,
      data: customers,
      pagination: {
        page,
        limit,
        total,
        totalPage: Math.ceil(total / limit),
      },
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};





const exportMerchantCustomersExcel = catchAsync(
  async (req: Request, res: Response) => {
    const merchant = req.user as { _id: string };

    if (!merchant?._id || !Types.ObjectId.isValid(merchant._id)) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized merchant" });
    }

    const merchantId = merchant._id;

    const customers = await SellService.exportMerchantCustomersFromDB(
      merchantId.toString(),
      req.query
    );

    // =========================
    // Excel Workbook
    // =========================
    const workbook = new ExcelJ.Workbook();
    workbook.creator = "Your Company Name";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Customers");

    sheet.columns = [
      { header: "Name", key: "Name", width: 25 },
      { header: "Email", key: "Email", width: 30 },
      { header: "Phone", key: "Phone", width: 18 },
      { header: "Country", key: "Country", width: 18 },
      { header: "Custom ID", key: "CustomID", width: 20 },
      { header: "Total Transactions", key: "TotalTransactions", width: 18 },
      { header: "Points Earned", key: "TotalPointsEarned", width: 18 },
      { header: "Points Redeemed", key: "TotalPointsRedeemed", width: 18 },
      { header: "Total Billed", key: "TotalBilled", width: 18 },
      { header: "Final Billed", key: "FinalBilled", width: 18 },
      { header: "Available Points", key: "AvailablePoints", width: 18 },
      { header: "Tier", key: "Tier", width: 15 },
      { header: "Created At", key: "CreatedAt", width: 20 },
      { header: "Sales Rep", key: "SalesRep", width: 25 },
      { header: "Rating", key: "Rating", width: 10 },
      { header: "Rating Comment", key: "RatingComment", width: 30 },
    ];

    customers.forEach((c) => {
      sheet.addRow({
        ...c,
        CreatedAt: c.CreatedAt
          ? new Date(c.CreatedAt).toLocaleString()
          : "",
      });
    });

    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = "A1:Q1";

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=merchant_customers.xlsx"
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.send(buffer);
  }
);


const getLastPendingSell = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    return sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "User not authenticated",
      data: "Data nai",
    });
  }

  const user = req.user as IUser;

  const data = await SellService.getLastPendingSellFromDB(user._id!.toString());

  if (!data) {
    return sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "No pending sell found",
      data: "Data nai",
    });
  }

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Last pending sell fetched successfully",
    data: data,
  });
});

export default {
  checkout,
  requestApproval,
  getPendingRequests,
  approvePromotion,
  approvePromotionreject,
  getPointsHistory,
  getMerchantSales,
  getMerchantCustomersList,
  getRecentMerchantCustomersList,
  getUserFullTransactions,
  exportMerchantCustomersExcel,
  getLastPendingSell,
  // finalizeCheckout
};
