// middlewares/uploadMiddleware.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 🔥 Gunakan path yang SAMA dengan server.js
// JANGAN gunakan path.join(__dirname, '../uploads')
const UPLOAD_BASE_PATH = process.env.UPLOAD_PATH || '/app/uploads';
const PROFILES_PATH = path.join(UPLOAD_BASE_PATH, 'profiles');

console.log(`📁 [UPLOAD] Using UPLOAD_BASE_PATH: ${UPLOAD_BASE_PATH}`);
console.log(`📁 [UPLOAD] PROFILES_PATH: ${PROFILES_PATH}`);

// Pastikan folder ada
if (!fs.existsSync(PROFILES_PATH)) {
    fs.mkdirSync(PROFILES_PATH, { recursive: true });
    console.log(`📁 [UPLOAD] Created directory: ${PROFILES_PATH}`);
}

// Konfigurasi storage multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        console.log(`📸 [UPLOAD] Saving to destination: ${PROFILES_PATH}`);
        cb(null, PROFILES_PATH);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        const filename = `${Date.now()}${ext}`;
        console.log(`📸 [UPLOAD] Saving file as: ${filename}`);
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