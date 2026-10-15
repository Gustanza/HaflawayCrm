// Firebase setup for HaflaCREM.
// Note: a Firebase web config is not a secret; data is protected by Firestore security rules (see firestore.rules).
import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

// `npm run dev:emu` sets this: everything runs against the local Firebase Emulator, never the live project.
const useEmulator = import.meta.env.VITE_USE_EMULATOR === "true";

const firebaseConfig = {
  apiKey: "AIzaSyAiekZYDRKNb-Cuf0NgTx1Vq00Bi-YRoq0",
  authDomain: "haflawaycrm.firebaseapp.com",
  projectId: "haflawaycrm",
  storageBucket: "haflawaycrm.firebasestorage.app",
  messagingSenderId: "1055651081560",
  appId: "1:1055651081560:web:6e70a82c076884ba73892d",
  measurementId: "G-RP8V724L9M"
};

// A "demo-" project id guarantees the emulator can never reach real Firebase resources.
export const app = initializeApp(useEmulator ? { ...firebaseConfig, projectId: "demo-haflacrem" } : firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
// Must match REGION in functions/index.js (the Firestore database location).
export const FUNCTIONS_REGION = "us-central1";
export const functions = getFunctions(app, FUNCTIONS_REGION);

if (useEmulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
} else {
  // Analytics is optional and unavailable in some environments (e.g. blocked by ad blockers).
  isSupported().then((ok) => ok && getAnalytics(app)).catch(() => {});
}
