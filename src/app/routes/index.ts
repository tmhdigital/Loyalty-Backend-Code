import express from "express";
import { UserRoutes } from "../modules/user/user.routes";
import { AuthRoutes } from "../modules/auth/auth.routes";
// import { PromoRoutes } from "../modules/promotionAdmin/promotionAdmin.routes";
import { RuleRoutes } from "../modules/rule/rule.route";
import { DashboardRoutes } from "../modules/dashboardOverview/dashboard.routes";
import { SubscriptionRoutes } from "../modules/subscription/subscription.routes";
import { KuickpayRoutes } from "../modules/kuickpay/kuickpay.routes";
import { PackageRoutes } from "../modules/package/package.routes";
import { SalesRepRoutes } from "../modules/salesRep/salesRep.route";
import { AdminRoutes } from "../modules/admin/admin.route";
import { DashboardMerchantRoutes } from "../modules/dashboardOverviewMerchant/dashboardMerchant.route";
import { MerchantCustomerListRoutes } from "../modules/merchant/merchantCustomerList/merchantCustomerList.routes";
import { contactUsRoutes } from "../modules/contactUs/contactUs.routes";
import { PromoMerchantRoutes } from "../modules/merchant/promotionMerchant/promotionMerchant.routes";
import { TierRoutes } from "../modules/merchant/point&TierSystem/tier.route";
import { DigitalCardRoutes } from "../modules/customer/digitalCard/digitalCard.routes";
import { SellManagementRoute } from "../modules/merchant/merchantSellManagement/merchantSellManagement.route";
import { RatingRoutes } from "../modules/customer/rating/rating.routes";
import { FavoriteRoutes } from "../modules/customer/favorite/favorite.routes";
import { RecentViewedPromotionRoutes } from "../modules/recentViewedPromotion/recentViewedPromotion.route";
import { AnalyticsRoutes } from "../modules/analytics/analytics.route";
import { UserManagementRoutes } from "../modules/userManagement/userManagement.routes";
import { AuditRoutes } from "../modules/auditLog/audit.routes";
import { AdminPromoMerchantRoutes } from "../modules/adminSellandTier/adminPromotion/adminPromotion.routes";
import { AdminTierRoutes } from "../modules/adminSellandTier/point&TierSystem/tierAdmin.route";
import { NotificationRoutes } from "../modules/notification/notification.routes";
import { PushRoutes } from "../modules/pushNotification/push.routes";
import { ReferralRoutes } from "../modules/referral/referral.route";

import { MerchantUserManagement } from "../modules/merchantUserManagement/merchantUserManagement.routes";

import { DisclaimerRoutes } from "../modules/disclaimer/disclaimer.route";
import { TransactionRoute } from "../modules/transactionHistory/transaction.routes";


const router = express.Router();

const apiRoutes = [
  { path: "/add-promotion", route: DigitalCardRoutes },
  { path: "/admin", route: AdminRoutes },
  { path: "/admin-promo", route: AdminPromoMerchantRoutes },
  { path: "/admin-tier", route: AdminTierRoutes },
  { path: "/auth", route: AuthRoutes },
  { path: "/audit", route: AuditRoutes },
  { path: "/contact", route: contactUsRoutes },
  { path: "/disclaimers", route: DisclaimerRoutes },
  { path: "/favorite", route: FavoriteRoutes },

  { path: "/history", route: TransactionRoute },
  { path: "/kuickpay", route: KuickpayRoutes },
  { path: "/merchant", route: DashboardMerchantRoutes },
  { path: "/merchant-customer", route: MerchantCustomerListRoutes },
  { path: "/merchant-user", route: MerchantUserManagement },
  { path: "/notifications", route: NotificationRoutes },
  { path: "/overview", route: DashboardRoutes },
  { path: "/package", route: PackageRoutes },
  { path: "/push-notification", route: PushRoutes },
  // { path: "/promo", route: PromoRoutes },
  { path: "/promo-merchant", route: PromoMerchantRoutes },
  { path: "/recent-viewed-promotions", route: RecentViewedPromotionRoutes },
  { path: "/referrals", route: ReferralRoutes },
  { path: "/report-analytics", route: AnalyticsRoutes },
  { path: "/rating", route: RatingRoutes },
  { path: "/rules", route: RuleRoutes },
  { path: "/sales-rep", route: SalesRepRoutes },
  { path: "/sell", route: SellManagementRoute },
  { path: "/subscription", route: SubscriptionRoutes },
  { path: "/tier", route: TierRoutes },
  { path: "/user", route: UserRoutes },
  { path: "/usermanagement", route: UserManagementRoutes },
];


apiRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
