import admin from "firebase-admin";

try {
  const serviceAccount: admin.ServiceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  };

  if (!admin.apps.length && serviceAccount.projectId && serviceAccount.privateKey) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else if (!admin.apps.length) {
    console.warn("⚠️ Firebase not initialized — projectId ya privateKey missing");
  }
} catch (err: any) {
  console.warn("⚠️ Firebase initialization failed, push notifications disabled:", err?.message || err);
}

export default admin;