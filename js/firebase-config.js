const firebaseConfig = {
  apiKey: "AIzaSyBLAjHFnboPY6KwhahRHqPSI_JOFYqBZPg",
  authDomain: "nycu-server-room.firebaseapp.com",
  projectId: "nycu-server-room",
  storageBucket: "nycu-server-room.firebasestorage.app",
  messagingSenderId: "1073885490717",
  appId: "1:1073885490717:web:3ba9fbd8afe22a6bd920f4",
  measurementId: "G-G9GHP692FJ"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);

// Firebase Auth 實例
const auth = firebase.auth();

// Firestore 資料庫實例
const db = firebase.firestore();

const secondaryApp = firebase.apps.find(app => app.name === 'secondary') || firebase.initializeApp(firebaseConfig, 'secondary');
const secondaryAuth = secondaryApp.auth();
