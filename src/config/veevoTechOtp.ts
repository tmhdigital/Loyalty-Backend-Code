import axios from "axios";
import config from "../config";

export const sendOtp = async (phone: string, otp: string) => {
  try {
    const url = "https://api.veevotech.com/v3/sendsms";

    const payload = {
      hash: config.veevoTech.apiKey,
      receivernum: phone,
      sendernum: "Default",
      textmessage: `Your OTP is ${otp}`,
    };

    const response = await axios.post(url, payload, { timeout: 10000 }); // 10s hard timeout, warna hang ho sakta hai



    // 🔴 Important validation
    if (response.data.STATUS !== "SUCCESSFUL") {
      throw new Error(
        `SMS Failed: ${response.data.ERROR_DESCRIPTION || "Unknown error"}`
      );
    }

    return response.data;
  } catch (error: any) {
    throw error;
  }
};