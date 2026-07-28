import { ICreateAccount, IResetPassword } from '../types/emailTemplate';

const createAccount = (values: ICreateAccount) => {
    const data = {
        to: values.email,
        subject: 'Verify your account',
        html: `
            <!doctype html>
            <html lang="en">
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Verify your account</title>
                <!--[if mso]>
                <style>* { font-family: Arial, sans-serif !important; }</style>
                <![endif]-->
                <style>
                    @media only screen and (max-width: 620px) {
                        .rw-container { width: 100% !important; }
                        .rw-padding { padding-left: 24px !important; padding-right: 24px !important; }
                        .rw-otp { font-size: 26px !important; letter-spacing: 6px !important; }
                    }
                </style>
            </head>
            <body style="margin: 0; padding: 0; background-color: #F3F5F7; -webkit-font-smoothing: antialiased;">
                <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">Your Rewaldo verification code is ready &ndash; it expires in 3 minutes.</div>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #F3F5F7;">
                    <tr>
                        <td align="center" style="padding: 48px 16px;">

                            <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="rw-container" style="width: 600px; max-width: 600px; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 24px rgba(24, 24, 24, 0.08);">

                                <!-- Header / Logo -->
                                <tr>
                                    <td class="rw-padding" style="padding: 36px 40px 28px; text-align: center; border-bottom: 1px solid #EEF0F2;">
                                        <img src="https://res.cloudinary.com/nfrmouhh/image/upload/c_fit,h_100/logo_qm0myw" alt="Rewaldo" width="140" height="50" style="display: block; margin: 0 auto; width: 140px; height: 50px; border: 0;" />
                                    </td>
                                </tr>

                                <!-- Body -->
                                <tr>
                                    <td class="rw-padding" style="padding: 40px;">
                                        <h1 style="margin: 0 0 16px; font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 22px; line-height: 1.4; font-weight: 600; color: #181818;">Hey, ${values.name}! 👋</h1>

                                        <p style="margin: 0 0 32px; font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #5B6270;">
                                            Thanks for signing up for Rewaldo. Use the verification code below to confirm your email address and activate your account.
                                        </p>

                                        <!-- OTP Card -->
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td align="center">
                                                    <p style="margin: 0 0 12px; font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #8A9099;">Your verification code</p>
                                                    <table role="presentation" cellpadding="0" cellspacing="0">
                                                        <tr>
                                                            <td style="background-color: #3FAE6A; border-radius: 10px; padding: 18px 44px;">
                                                                <span class="rw-otp" style="font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 30px; font-weight: 700; letter-spacing: 8px; color: #FFFFFF;">${values.otp}</span>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                    <p style="margin: 16px 0 0; font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #8A9099;">This code expires in <strong style="color: #5B6270;">3 minutes</strong>.</p>
                                                </td>
                                            </tr>
                                        </table>

                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 36px; border-top: 1px solid #EEF0F2;">
                                            <tr>
                                                <td style="padding-top: 24px; font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #9AA0A8;">
                                                    If you did not create a Rewaldo account, you can safely ignore this email.
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>

                                <!-- Footer -->
                                <tr>
                                    <td class="rw-padding" style="padding: 28px 40px; text-align: center; background-color: #FAFBFC; border-top: 1px solid #EEF0F2;">
                                        <p style="margin: 0; font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.6; color: #9AA0A8;">&copy; 2025 Rewaldo. All rights reserved.</p>
                                    </td>
                                </tr>

                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `
    }

    return data;
}


const resetPassword = (values: IResetPassword) => {
    const data = {
        to: values.email,
        subject: 'Reset your password',
        html: `
            <!doctype html>
            <html lang="en">
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Reset your password</title>
                <!--[if mso]>
                <style>* { font-family: Arial, sans-serif !important; }</style>
                <![endif]-->
                <style>
                    @media only screen and (max-width: 620px) {
                        .rw-container { width: 100% !important; }
                        .rw-padding { padding-left: 24px !important; padding-right: 24px !important; }
                        .rw-otp { font-size: 26px !important; letter-spacing: 6px !important; }
                    }
                </style>
            </head>
            <body style="margin: 0; padding: 0; background-color: #F3F5F7; -webkit-font-smoothing: antialiased;">
                <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">Use this code to reset your Rewaldo account password. It expires in 3 minutes.</div>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #F3F5F7;">
                    <tr>
                        <td align="center" style="padding: 48px 16px;">

                            <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="rw-container" style="width: 600px; max-width: 600px; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 24px rgba(24, 24, 24, 0.08);">

                                <!-- Header / Logo -->
                                <tr>
                                    <td class="rw-padding" style="padding: 36px 40px 28px; text-align: center; border-bottom: 1px solid #EEF0F2;">
                                        <img src="https://res.cloudinary.com/nfrmouhh/image/upload/c_fit,h_100/logo_qm0myw" alt="Rewaldo" width="140" height="50" style="display: block; margin: 0 auto; width: 140px; height: 50px; border: 0;" />
                                    </td>
                                </tr>

                                <!-- Body -->
                                <tr>
                                    <td class="rw-padding" style="padding: 40px;">
                                        <h1 style="margin: 0 0 16px; font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 22px; line-height: 1.4; font-weight: 600; color: #181818;">Reset your password</h1>

                                        <p style="margin: 0 0 32px; font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #5B6270;">
                                            We received a request to reset the password on your Rewaldo account. Use the verification code below to continue.
                                        </p>

                                        <!-- OTP Card -->
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td align="center">
                                                    <p style="margin: 0 0 12px; font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #8A9099;">Your verification code</p>
                                                    <table role="presentation" cellpadding="0" cellspacing="0">
                                                        <tr>
                                                            <td style="background-color: #3FAE6A; border-radius: 10px; padding: 18px 44px;">
                                                                <span class="rw-otp" style="font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 30px; font-weight: 700; letter-spacing: 8px; color: #FFFFFF;">${values.otp}</span>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                    <p style="margin: 16px 0 0; font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #8A9099;">This code expires in <strong style="color: #5B6270;">3 minutes</strong>.</p>
                                                </td>
                                            </tr>
                                        </table>

                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 36px; border-top: 1px solid #EEF0F2;">
                                            <tr>
                                                <td style="padding-top: 24px; font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #9AA0A8;">
                                                    If you did not request a password reset, you can safely ignore this email &mdash; your password will remain unchanged.
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>

                                <!-- Footer -->
                                <tr>
                                    <td class="rw-padding" style="padding: 28px 40px; text-align: center; background-color: #FAFBFC; border-top: 1px solid #EEF0F2;">
                                        <p style="margin: 0; font-family: 'Poppins', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.6; color: #9AA0A8;">&copy; 2025 Rewaldo. All rights reserved.</p>
                                    </td>
                                </tr>

                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `,
    };
    return data;
};


const createAccountNotification = (values: {
  email: string;
  name: string;
  password: string;
}) => {
  return {
    to: values.email,
    subject: "Your Account Has Been Created",
    html: `
      <body style="font-family: Arial; background:#f9f9f9; padding:20px;">
        <div style="max-width:600px;margin:auto;background:#fff;padding:20px;border-radius:10px;">
          
          <h2 style="color:#277E16;">Welcome ${values.name} 🎉</h2>

          <p>Your account has been successfully created.</p>

          <h3>Login Details:</h3>

          <p><b>Email:</b> ${values.email}</p>
          <p><b>Password:</b> ${values.password}</p>

          <p style="margin-top:20px;color:#888;">
            Please change your password after first login for security.
          </p>
        </div>
      </body>
    `,
  };
};

export const emailTemplate = {
    createAccount,
    resetPassword,
    createAccountNotification,
};