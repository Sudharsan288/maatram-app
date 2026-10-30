
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBmjnDDtijU1pOZQcnQkmBGNkCAA8dtYdk",
  authDomain: "maatram-student-support.firebaseapp.com",
  projectId: "maatram-student-support",
  storageBucket: "maatram-student-support.firebasestorage.app",
  messagingSenderId: "243908134413",
  appId: "1:243908134413:web:7dcbd67961d7d8cf10b744",
  measurementId: "G-5Y59EEG2YP"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
