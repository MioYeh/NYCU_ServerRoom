/**
 * Firebase 初始化設定（範例）
 * 
 * 使用方式：
 *   1. 複製此檔案並重新命名為 firebase-config.js
 *   2. 將下方的值替換為你自己的 Firebase 專案設定
 *   3. 若部署到 GitHub Pages，請確保 firebase-config.js 會被部署（可公開）
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


// (可選) 第二個 Auth 實例：供管理員新增使用者時使用，不影響目前登入狀態
const secondaryApp = firebase.apps.find(app => app.name === 'secondary') || firebase.initializeApp(firebaseConfig, 'secondary');
const secondaryAuth = secondaryApp.auth();
