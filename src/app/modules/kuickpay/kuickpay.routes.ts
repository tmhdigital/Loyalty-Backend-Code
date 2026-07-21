import express from "express";
import auth from "../../middlewares/auth";
import { KuickpayController } from "./kuickpay.controller";

const router = express.Router();

router.post("/create", auth(), KuickpayController.initiateCheckout);

// Authenticated — called by the app after its WebView lands on the return URL.
// This is what actually guarantees the subscription gets activated even if the
// browser redirect or the IPN never reaches us.
router.post("/confirm", auth(), KuickpayController.confirmPayment);

// Authenticated — polling fallback while we wait for the IPN
router.get("/order/:orderId", auth(), KuickpayController.getOrderStatus);

// Public — hit by the customer's browser/webview redirect, not authenticated
router.get("/return", KuickpayController.handleReturn);

// Public — hit server-to-server by Kuickpay, not authenticated
router.get("/ipn", KuickpayController.handleIpn);
router.post("/ipn", KuickpayController.handleIpn);

export const KuickpayRoutes = router;