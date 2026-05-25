const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

// 1. Load environment variables paling awal
dotenv.config();

const app = express();

// --- TAMBAHAN: Auto-create folders untuk uploads ---
const uploadDirs = ['uploads', 'uploads/profiles', 'uploads/certificates'];
uploadDirs.forEach(dir => {
    const fullPath = path.join(__dirname, dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
    }
});

// --- MIDDLEWARE KEAMANAN & KONFIGURASI ---

app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
}));

// CORS Configuration
const allowedOrigins = [
    'http://localhost:8081',
    'http://localhost:8082',
    'https://myrts.netlify.app',
    'https://mitrarts.netlify.app',
    'https://admin-rts.netlify.app',
    'https://api.siappgo.id',
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            return callback(new Error('CORS policy violation'), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

// Logger
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 🔥 PERBAIKAN: Static Files dengan path yang benar
// Pastikan folder uploads bisa diakses via /uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
console.log(`📁 Static files served from: ${path.join(__dirname, 'uploads')}`);
console.log(`📁 Access via: /uploads/`);

// 🔥 Tambahkan juga endpoint untuk cek file
app.get('/uploads/check/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(__dirname, 'uploads/profiles', filename);

    if (fs.existsSync(filepath)) {
        res.json({
            success: true,
            message: 'File exists',
            path: filepath,
            url: `/uploads/profiles/${filename}`
        });
    } else {
        res.status(404).json({
            success: false,
            message: 'File not found',
            searchedPath: filepath
        });
    }
});

// --- ROUTES ---
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const mitraRoutes = require('./src/routes/mitraRoutes');
const walletRoutes = require('./src/routes/walletRoutes');
const serviceRoutes = require('./src/routes/serviceRoutes');
const deviceTokenRoutes = require('./src/routes/deviceTokenRoutes');

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/mitra', mitraRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/services', serviceRoutes);
app.use('/api/v1/devices', deviceTokenRoutes);

// Root Health Check
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: "Bone & Joint Massage API",
        env: process.env.NODE_ENV,
        version: "1.0.0"
    });
});

// 404 Handler
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        message: `Endpoint ${req.originalUrl} tidak ditemukan`
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
    console.error('🔥 Error Stack:', err.stack);
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        success: false,
        message: err.message || "Internal Server Error",
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// --- SERVER INITIALIZATION ---
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`
    =============================================
    🚀 Server berjalan di port: ${PORT}
    🛠️  Mode: ${process.env.NODE_ENV || 'development'}
    📅 Time: ${new Date().toLocaleString('id-ID')}
    📁 Uploads directory: ${path.join(__dirname, 'uploads')}
    =============================================
    `);
});

// Handle Unhandled Rejections
process.on('unhandledRejection', (err) => {
    console.log('UNHANDLED REJECTION! 💥 Shutting down...');
    console.log(err.name, err.message);
    server.close(() => {
        process.exit(1);
    });
});