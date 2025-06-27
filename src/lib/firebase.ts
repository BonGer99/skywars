// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration is now hardcoded here.
const firebaseConfig = {
  apiKey: "AIzaSyBO0bk31m7aenlOFtmRLi-ldenzCq2DPxM",
  authDomain: "voxel-aces.firebaseapp.com",
  projectId: "voxel-aces",
  storageBucket: "voxel-aces.appspot.com",
  messagingSenderId: "438756648013",
  appId: "1:438756648013:web:26aa83ff80a91064b66804"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

export { db };
