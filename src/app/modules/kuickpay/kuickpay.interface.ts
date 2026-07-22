export type KuickpayTokenResponse = {
  auth_token: string;
};

export type KuickpayRedirectionForm = {
  InstitutionID: string;
  OrderID: string;
  MerchantName: string;
  Amount: string;
  TransactionDescription: string;
  CustomerMobileNumber: string;
  CustomerEmail: string;
  SuccessUrl: string;
  FailureUrl: string;
  OrderDate: string;
  CheckoutUrl: string;
  Token: string;
  GrossAmount: string;
  TaxAmount: string;
  Discount: "0" | "1";
  Signature: string;
};

export type KuickpayInitiateResponse = {
  // The URL the mobile app should POST the form fields to
  redirectionUrl: string;
  // Form fields the app must send as x-www-form-urlencoded / multipart body
  formData: KuickpayRedirectionForm;
  orderId: string;
};

export type KuickpayReturnParams = {
  TransactionId?: string;
  OrderId?: string;
  ResponseCode?: string;
  Signature?: string;
};
