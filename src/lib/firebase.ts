// This file is now primarily for configuration and potential future use
// with services like Firebase Auth. The real-time database logic for gameplay
// has been moved to an in-memory model.

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration is now hardcoded here.
const firebaseConfig = {
  apiKey: "AIzaSyBO0bk31m7aenlOFtmRLi-ldenzCq2DPxM",
  authDomain: "voxel-aces.firebaseapp.com",
  projectId: "voxel-aces",
  storageBucket: "voxel-aces.firebasestorage.app",
  messagingSenderId: "438756648013",
  appId: "1:438756648013:web:26aa83ff80a91064b66804"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
// We keep Firestore initialized for potential future use (e.g. storing user profiles, hangar setups, etc.)
const db = getFirestore(app);

export { db };
