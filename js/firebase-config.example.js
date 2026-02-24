/**
 * Firebase 初始化設定（範例）
 * 
 * 使用方式：
 *   1. 複製此檔案並重新命名為 firebase-config.js
 *   2. 將下方的值替換為你自己的 Firebase 專案設定
 *   3. firebase-config.js 已被 .gitignore 排除，不會被推送到 GitHub
 */

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);

// Firebase Auth 實例
const auth = firebase.auth();

// Firestore 資料庫實例
const db = firebase.firestore();
