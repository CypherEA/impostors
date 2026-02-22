import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
    // Boilerplate for User to replace
    apiKey: "AIzaSy_YOUR_API_KEY",
    authDomain: "boilermakergrc-monitor.firebaseapp.com",
    projectId: "boilermakergrc-monitor",
    storageBucket: "boilermakergrc-monitor.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef123456"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
