import express from "express";
import auth from "../../middlewares/auth";
import { KuickpayController } from "./kuickpay.controller";

const router = express.Router();

router.post("/create", auth(), KuickpayController.initiateCheckout);

// Public — hit by the customer's browser/webview redirect, not authenticated
router.get("/return", KuickpayController.handleReturn);

// Public — hit server-to-server by Kuickpay, not authenticated
router.get("/ipn", KuickpayController.handleIpn);
router.post("/ipn", KuickpayController.handleIpn);

export const KuickpayRoutes = router;
