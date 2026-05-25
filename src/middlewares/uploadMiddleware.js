// middlewares/uploadMiddleware.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 🔥 PASTIKAN menggunakan UPLOAD_PATH dari environment
const UPLOAD_BASE_PATH = process.env.UPLOAD_PATH || '/app/uploads';
const PROFILES_PATH = path.join(UPLOAD_BASE_PATH, 'profiles');

console.log(`\n========== [UPLOAD MIDDLEWARE] ==========`);
console.log(`📁 UPLOAD_BASE_PATH: ${UPLOAD_BASE_PATH}`);
console.log(`📁 PROFILES_PATH: ${PROFILES_PATH}`);
console.log(`==========================================\n`);

// Pastikan folder ada
if (!fs.existsSync(PROFILES_PATH)) {
    fs.mkdirSync(PROFILES_PATH, { recursive: true });
    console.log(`📁 Created directory: ${PROFILES_PATH}`);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        console.log(`📸 Saving file to: ${PROFILES_PATH}`);
        cb(null, PROFILES_PATH);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        const filename = `${Date.now()}${ext}`;
        console.log(`📸 Filename: ${filename}`);
        cb(null, filename);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
        cb(null, true);
    } else {
        cb(new Error('Hanya file gambar yang diperbolehkan (jpeg, jpg, png, gif, webp)'));
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: fileFilter
});

module.exports = upload;