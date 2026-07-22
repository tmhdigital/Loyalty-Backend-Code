import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env") });





export default {
  ip_address: process.env.IP_ADDRESS,
  port: process.env.PORT,
  // api_url: process.env.API_URL,

  client_url: process.env.CLIENT_URL,
  admin_url: process.env.ADMIN_URL,

  database_url: process.env.DATABASE_URL,
  node_env: process.env.NODE_ENV,
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS,
  jwt: {
    jwt_secret: process.env.JWT_SECRET as string,
    jwt_expire_in: process.env.JWT_EXPIRE_IN || "15m",
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET as string,
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },

  stripe: {
    stripeSecretKey: process.env.STRIPE_API_SECRET,
    webhookSecret: process.env.WEBHOOK_SECRET,
    paymentSuccess: process.env.STRIPE_PAYMENT_SUCCESS,

    successUrl: process.env.STRIPE_SUCCESS_URL,
    cancelUrl: process.env.STRIPE_CANCEL_URL,
    // paymentSuccess: process.env.STRIPE_PAYMENT_SUCCESS,
  },
  email: {
    from: process.env.EMAIL_FROM,
    user: process.env.EMAIL_USER,
    port: process.env.EMAIL_PORT,
    host: process.env.EMAIL_HOST,
    pass: process.env.EMAIL_PASS,
  },
  social: {
    google_client_id: process.env.GOOGLE_CLIENT_ID,
    facebook_client_id: process.env.FACEBOOK_CLIENT_ID,
    google_client_secret: process.env.GOOGLE_CLIENT_SECRET,
    facebook_client_secret: process.env.FACEBOOK_CLIENT_SECRET,
  },
  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    twilioNumber: process.env.TWILIO_NUMBER,
  },
  veevoTech: {
    apiKey: process.env.VEEVOTECH_API_KEY,
    senderId: process.env.VEEVOTECH_SENDER_ID,
  },
  m3Sms: {
    userId: process.env.M3_SMS_USER_ID,
    password: process.env.M3_SMS_PASSWORD,
    header: process.env.M3_SMS_HEADER,
    url: process.env.M3_SMS_URL,
  },
  frontendUrl: process.env.FRONTEND_URL,
};
