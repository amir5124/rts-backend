// config/firebaseConfig.js
const admin = require('firebase-admin');
const path = require('path');

// __dirname adalah folder 'config'
// Kita langsung masuk ke folder 'firebase' dan mengambil file 'firebase-adminsdk.json'
const serviceAccountPath = path.join(__dirname, 'firebase', 'firebase-adminsdk.json');

try {
    // Memuat file JSON secara dinamis berdasarkan path absolut di atas
    const serviceAccount = require(serviceAccountPath);

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("✅ Firebase Admin SDK Initialized Successfully from config/firebase/");
    }
} catch (error) {
    console.error("❌ Firebase Admin Initialization Error:");
    console.error("Lokasi yang dicari:", serviceAccountPath);
    console.error("Pesan Error:", error.message);

    if (error.code === 'MODULE_NOT_FOUND') {
        console.error("Tips: Pastikan file 'firebase-adminsdk.json' sudah diletakkan di dalam folder 'config/firebase/'.");
    }
}

module.exports = admin;