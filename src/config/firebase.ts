import admin from "firebase-admin";

try {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY_BASE64
    ? Buffer.from(process.env.FIREBASE_PRIVATE_KEY_BASE64, "base64").toString("utf-8")
    : process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  const serviceAccount = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: privateKey,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
    universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
  } as admin.ServiceAccount;

  if (!admin.apps.length && serviceAccount.projectId && privateKey) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else if (!admin.apps.length) {
    console.warn("⚠️ Firebase not initialized — project_id ya private_key missing");
  }
} catch (err: any) {
  console.warn("⚠️ Firebase initialization failed, push notifications disabled:", err?.message || err);
}

export default admin;