import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCpCIXAbz4fQ6BlLnGoo6Clpxa7Cktn4b0",
  authDomain: "progresspoint-6ae23.firebaseapp.com",
  projectId: "progresspoint-6ae23",
  storageBucket: "progresspoint-6ae23.firebasestorage.app",
  messagingSenderId: "829258673464",
  appId: "1:829258673464:web:8d30b189e46288fad0a5cd"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
