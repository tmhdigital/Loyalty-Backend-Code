import nodemailer from 'nodemailer';
import config from '../config';
import { errorLogger, logger } from '../shared/logger';
import { ISendEmail } from '../types/email';
import ApiError from '../errors/ApiErrors';
import { StatusCodes } from 'http-status-codes';

const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: Number(config.email.port),
    secure: false,
    auth: {
        user: config.email.user,
        pass: config.email.pass
    },
    tls: {
    rejectUnauthorized: false, // <-- ignore SSL mismatch
  },
    // Short timeouts. DigitalOcean aksar outbound SMTP block/slow karta hai,
    // in ke bina sendMail ~2 min tak hang kar sakta hai.
    connectionTimeout: 8000, // 8s TCP connect
    greetingTimeout: 8000,   // 8s SMTP greeting
    socketTimeout: 10000,    // 10s idle socket
});

const sendEmail = async (values: ISendEmail) => {
  try {
    logger.info("📧 Attempting to send email", {
      to: values.to,
      subject: values.subject,
    });

    const info = await transporter.sendMail({
      from: `"Mlitech" <${config.email.from}>`,
      to: values.to,
      subject: values.subject,
      html: values.html,
    });

    logger.info("✅ Mail sent successfully", {
      accepted: info.accepted,
      messageId: info.messageId,
    });

    return info;
  } catch (error) {
    errorLogger.error("❌ Email send failed", error);

    // 🔥 IMPORTANT
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Failed to send OTP email"
    );
  }
};


export const emailHelper = {
    sendEmail
};