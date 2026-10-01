import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { StatusCodes } from "http-status-codes";
import { MerchantAnalyticsService } from "./merchant-analytics.service";
import { CustomerAnalyticsService } from "./customer-analytics.service";
import { CashAnalyticsService } from "./cash-analytics.service";
import { PointAnalyticsService } from "./point-analytics.service";
import * as ExcelJS from "exceljs";
import { generateExcelBuffer } from "../../../helpers/excelExport";

// User creates report
const getBusinessCustomerAnalytics = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as any;

    const merchantId = user._id;
    const role = user.role;
    const isSubMerchant = user.isSubMerchant;
    const mainMerchantId = user.merchantId?.toString();

    const {
      startDate,
      endDate,
      page = "1",
      limit = "10",
      subscriptionStatus,
      customerName,
      location,
      city,
      paymentStatus
    } = req.query;

    const result = await CustomerAnalyticsService.getBusinessCustomerAnalytics(
      merchantId,
      startDate as string,
      endDate as string,
      Number(page),
      Number(limit),
      {
        subscriptionStatus: subscriptionStatus as string,
        customerName: customerName as string,
        location: location as string,
        city: city as string,
        paymentStatus: paymentStatus as string,
      },
      role,
      isSubMerchant,
      mainMerchantId
    );

    const data = result.data;
    const pagination = result.pagination;

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: "Customer analytics fetched successfully",
      data: data,
      pagination: pagination,
    });
  }
);



const exportBusinessCustomerAnalytics = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as any;

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new Error("startDate and endDate are required");
    }


    const bufferData =
      await CustomerAnalyticsService.getBusinessCustomerAnalytics(
        user._id,
        startDate as string,
        endDate as string,
        1,
        10,
        {}, // filters empty for export
        user.role,
        user.isSubMerchant,
        user.merchantId?.toString()
      );

    const monthlyData = bufferData.data.monthlyData;



    /* ==============================
       📦 EXCEL WORKBOOK
    ============================== */
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Monthly Business Report");

    /* ==============================
       📌 COLUMNS
    ============================== */
    worksheet.columns = [
      { header: "Year", key: "year", width: 10 },
      { header: "Month Name", key: "monthName", width: 15 },
      { header: "Total Revenue", key: "totalRevenue", width: 18 },
      { header: "Points Earned", key: "totalPointsAccumulated", width: 18 },
      { header: "Points Redeemed", key: "totalPointsRedeemed", width: 18 },
      { header: "Visits", key: "totalUsers", width: 12 },
    ];

    /* ==============================
       📌 ROWS
    ============================== */
    monthlyData.forEach((item: any) => {
      worksheet.addRow({
        year: item.year,
        monthName: item.monthName,
        totalRevenue: item.totalRevenue,
        totalPointsAccumulated: item.totalPointsAccumulated,
        totalPointsRedeemed: item.totalPointsRedeemed,
        totalUsers: item.totalUsers,
      });
    });

    /* ==============================
       🎯 HEADER STYLE (PRO LOOK)
    ============================== */
    worksheet.getRow(1).font = {
      bold: true,
      size: 12,
    };

    worksheet.getRow(1).alignment = {
      vertical: "middle",
      horizontal: "center",
    };

    /* ==============================
       📤 BUFFER
    ============================== */
    const buffer = await workbook.xlsx.writeBuffer();

    /* ==============================
       📥 RESPONSE HEADERS
    ============================== */
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=business-customer-monthly-report.xlsx`
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );



    return res.send(buffer);
  }
);




const getMerchantAnalytics = catchAsync(async (req: Request, res: Response) => {

  const {
    startDate,
    endDate,
    page = "1",
    limit = "10",
    subscriptionStatus,
    customerName,
    location,
    paymentStatus,
    city
  } = req.query;



  const userRole = (req.user as any)?.role;


  const result = await MerchantAnalyticsService.getMerchantAnalytics(
    startDate as string,
    endDate as string,
    Number(page),
    Number(limit),
    {
      subscriptionStatus: subscriptionStatus as string,
      customerName: customerName as string,
      location: location as string,
      paymentStatus: paymentStatus as string,
      city: city as string
    },
    userRole,
    // merchantId
  );



  const data = result.data;
  const pagination = result.pagination;

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Merchant customer analytics fetched successfully",
    data: data,
    pagination: pagination,
  });
});




const getCustomerAnalytics = catchAsync(async (req: Request, res: Response) => {
  const {
    startDate,
    endDate,
    page = "1",
    limit = "10",
    subscriptionStatus,
    customerName,
    location,
    paymentStatus,
    city
  } = req.query;



  // Get logged-in user role
  const userRole = (req.user as any)?.role;


  const result = await CustomerAnalyticsService.getCustomerAnalytics(
    startDate as string,
    endDate as string,
    Number(page),
    Number(limit),
    {
      subscriptionStatus: subscriptionStatus as string,
      customerName: customerName as string,
      location: location as string,
      paymentStatus: paymentStatus as string,
      city: city as string
    },
    userRole // pass role
  );



  const data = result.data;
  const pagination = result.pagination;

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Customer analytics fetched successfully",
    data: data,
    pagination: pagination,
  });
});




const exportCustomerAnalytics = catchAsync(
  async (req: Request, res: Response) => {
    const { startDate, endDate, subscriptionStatus, customerName, location } =
      req.query;

    const buffer = await CustomerAnalyticsService.exportCustomerAnalytics(
      startDate as string,
      endDate as string,
      {
        subscriptionStatus: subscriptionStatus as string,
        customerName: customerName as string,
        location: location as string,
      }
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=customer-analytics-full.xlsx"
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.status(200).send(buffer);
  }
);



// controller.ts
const exportMerchantAnalytics = catchAsync(
  async (req: Request, res: Response) => {
    const {
      startDate,
      endDate,
      subscriptionStatus,
      customerName,
      location,
      paymentStatus,
      city,
    } = req.query;

    const result = await MerchantAnalyticsService.getMerchantAnalyticsExport(
      startDate as string,
      endDate as string,
      1,
      0,
      {
        subscriptionStatus: subscriptionStatus as string,
        customerName: customerName as string,
        location: location as string,
        paymentStatus: paymentStatus as string,
        city: city as string,
      }
    );

   

    const safeRows = result.records.map((r: any) => ({
      ...r,
      pointsAccumulated: r.pointsAccumulated || 0,
      pointsRedeemed: r.pointsRedeemed || 0,
      totalRevenue: r.totalRevenue || 0,
      subscriptionStatus: r.subscriptionStatus || "inactive",
    }));

    const columns = [
      { header: "Business Name", key: "merchantName" },
      { header: "Email", key: "email" },
      { header: "Phone", key: "phone" },
      { header: "Location", key: "location" },
      { header: "Membership Status", key: "subscriptionStatus" },
      { header: "Payment Status", key: "paymentStatus" },
      { header: "Points Accumulated", key: "pointsAccumulated" },
      { header: "Points Redeemed", key: "pointsRedeemed" },
      { header: "Total Revenue", key: "totalRevenue" },
      { header: "Joining Date", key: "date" },
    ];

    const buffer = await generateExcelBuffer({
      sheetName: "Merchant Analytics",
      columns,
      rows: safeRows,
    });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=merchant-analytics.xlsx`
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.send(buffer);
  }
);




const exportMerchantMonthlyAnalytics = catchAsync(
  async (req: Request, res: Response) => {
    const { startDate, endDate } = req.query;

    const user = req.user as any;
    const role = user.role;



    const result = await MerchantAnalyticsService.getMerchantAnalytics(
      startDate as string,
      endDate as string,
      1,
      0,
      {},
      role
    );

    const monthlyData = result?.data?.monthlyData || [];



    const rows = monthlyData.map((item: any) => ({
      year: item.year,
      // month: item.month,
      monthName: item.monthName,
      totalRevenue: Number(item.totalRevenue ?? 0),
      pointsEarned: Number(item.pointsEarned ?? 0),
      pointsRedeemed: Number(item.pointsRedeemed ?? 0),
      users: Number(item.users ?? 0),
    }));

    const columns = [
      { header: "Year", key: "year" },
      // { header: "Month", key: "month" },
      { header: "Month Name", key: "monthName" },
      { header: "Total Revenue", key: "totalRevenue" },
      { header: "Points Earned", key: "pointsEarned" },
      { header: "Points Redeemed", key: "pointsRedeemed" },
      { header: "Visits", key: "users" },
    ];

    const buffer = await generateExcelBuffer({
      sheetName: "Monthly Report",
      columns,
      rows,
    });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=merchant-monthly-report.xlsx`
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    return res.send(buffer);
  }
);



const exportCustomerMonthlyData = catchAsync(
  async (req: Request, res: Response) => {
    const { startDate, endDate, userRole } = req.query;

 

    // -------- Fetch Monthly Report --------
    const result = await CustomerAnalyticsService.getCustomerMonthlyReport(
      startDate as string,
      endDate as string,
      {}, // filters
      (userRole as string) || "USER"
    );

    const monthlyData = result.monthlyData;



    // -------- Excel Columns --------
    const columns = [
      { header: "Year", key: "year" },
      { header: "Month", key: "monthName" },
      { header: "Total Revenue", key: "totalRevenue" },
      { header: "Points Earned", key: "pointsEarned" },
      { header: "Points Redeemed", key: "pointsRedeemed" },
      { header: "Visits ", key: "users" },
    ];

    // -------- Generate Excel --------
    const buffer = await generateExcelBuffer({
      sheetName: "Customer Monthly Report",
      columns,
      rows: monthlyData,
    });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=customer-monthly-report.xlsx`
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.send(buffer);
  }
);


const getPointRedeemedAnalytics = catchAsync(async (req: Request, res: Response) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const result = await PointAnalyticsService.getPointRedeemedAnalytics({
    startDate: req.query.startDate as string,
    endDate: req.query.endDate as string,
    page,
    limit,
  });
  const data = { data: result.data, timeRange: result.timeRange };
  const pagination = result.pagination;

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Points redeemed analytics fetched successfully",
    data: data,
    pagination: pagination,
  });
});

const exportPointRedeemedAnalytics = catchAsync(async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;
  await PointAnalyticsService.exportPointRedeemedAnalytics(res, startDate as string, endDate as string);
});

const getRevenuePerUser = catchAsync(async (req: Request, res: Response) => {

  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const result = await CashAnalyticsService.getRevenuePerUser({
    startDate: req.query.startDate as string,
    endDate: req.query.endDate as string,
    page,
    limit,
  });

  const data = { data: result.data, timeRange: result.timeRange };
  const pagination = result.pagination;

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Revenue per user analytics fetched successfully",
    data: data,
    pagination: pagination,
  });
});

const exportRevenuePerUser = catchAsync(async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;
  await CashAnalyticsService.exportRevenuePerUser(res, startDate as string, endDate as string);
});

const getCashCollectionAnalytics = catchAsync(async (req: Request, res: Response) => {

  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const result = await CashAnalyticsService.getCashCollectionAnalytics({
    startDate: req.query.startDate as string,
    endDate: req.query.endDate as string,
    page,
    limit,
  });

  const data = { data: result.data, timeRange: result.timeRange };
  const pagination = result.pagination;

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Cash collection analytics fetched successfully",
    data: data,
    pagination: pagination,
  });
});

const exportCashCollectionAnalytics = catchAsync(async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;
  await CashAnalyticsService.exportCashCollectionAnalytics(res, startDate as string, endDate as string);
});


const getCashReceivableAnalytics = catchAsync(async (req: Request, res: Response) => {

  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const result = await CashAnalyticsService.getCashReceivableAnalytics({
    startDate: req.query.startDate as string,
    endDate: req.query.endDate as string,
    page,
    limit,
  });

  const data = { data: result.data, timeRange: result.timeRange };
  const pagination = result.pagination;

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Cash receivable analytics fetched successfully",
    data: data,
    pagination: pagination,
  });
});



const exportCashReceivableAnalytics = catchAsync(async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;
  await CashAnalyticsService.exportCashReceivableAnalytics(res, startDate as string, endDate as string);
});

export const AnalyticsController = {
  getBusinessCustomerAnalytics,
  getMerchantAnalytics,
  getCustomerAnalytics,
  exportMerchantAnalytics,
  exportCustomerAnalytics,
  exportBusinessCustomerAnalytics,
  exportMerchantMonthlyAnalytics,
  exportCustomerMonthlyData,
  getPointRedeemedAnalytics,
  exportPointRedeemedAnalytics,
  getRevenuePerUser,
  exportRevenuePerUser,
  getCashCollectionAnalytics,
  exportCashCollectionAnalytics,
  getCashReceivableAnalytics,
  exportCashReceivableAnalytics
};
