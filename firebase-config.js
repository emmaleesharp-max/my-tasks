// ---------------------------------------------------------------
// Your Firebase project's config, from the "my-tasks-dd101" project.
// ---------------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCS4D_xRTgZ5mzRIs39bN7GfjO5agKkqK4",
  authDomain: "my-tasks-dd101.firebaseapp.com",
  projectId: "my-tasks-dd101",
  storageBucket: "my-tasks-dd101.firebasestorage.app",
  messagingSenderId: "537743088514",
  appId: "1:537743088514:web:06b02307ee0b5c872acd9b"
};

export const firebaseApp = initializeApp(firebaseConfig);

// ---------------------------------------------------------------
// For the read-only Calendar view — a separate Google Cloud OAuth
// client (not the same as the Firebase apiKey above). See the
// "Calendar view setup" section in README.md for how to get this.
// ---------------------------------------------------------------
export const GOOGLE_CALENDAR_CLIENT_ID = "537743088514-v9et2al3bt347qqqgfbabaf2tb0neicp.apps.googleusercontent.com";

