import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
    apiKey: "AIzaSyCrLp2dD9oaM66XSnuF3xrvKQg345dG-so",
    authDomain: "boilermaker-impostors.firebaseapp.com",
    projectId: "boilermaker-impostors",
    storageBucket: "boilermaker-impostors.firebasestorage.app",
    messagingSenderId: "368342941852",
    appId: "1:368342941852:web:a71d437626519ed500ed59"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);



