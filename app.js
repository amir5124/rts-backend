// app.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

// =============================================
// 1. LOAD ENVIRONMENT VARIABLES - DIPERBAIKI
// =============================================

// 🔥 Cek lokasi file .env
const envPath = path.resolve(process.cwd(), '.env');
console.log(`📁 Looking for .env at: ${envPath}`);

if (fs.existsSync(envPath)) {
    console.log('✅ .env file found!');
    const envContent = fs.readFileSync(envPath, 'utf8');
    console.log('📄 .env content preview:');
    console.log(envContent.split('\n').filter(line => line.trim() && !line.startsWith('#')));
} else {
    console.error('❌ .env file NOT FOUND at:', envPath);
    console.error('⚠️  Creating default .env file...');
    
    // 🔥 Buat .env file secara otomatis
    const defaultEnv = `PORT=3000
NODE_ENV=development
DB_HOST=31.97.48.240
DB_USER=mysql
DB_PASS=y8ORze0Ta2a0BRjiInuY3KmZiSLySa9qbf6smZXihcpETIzV6CgOHrOaVGZfhQCz
DB_NAME=rts
DB_PORT=3306
JWT_SECRET=rahasia_super_kuat_amir_2026
UPLOAD_PATH=/app/uploads
`;
    fs.writeFileSync(envPath, defaultEnv);
    console.log('✅ Default .env file created!');
}

// 🔥 Load .env dengan path absolut
dotenv.config({ path: envPath });

// 🔥 🔥 🔥 VALIDASI DENGAN CARA YANG LEBIH BAIK
console.log('\n🔐 ========== ENVIRONMENT VALIDATION ==========');
console.log(`🔐 NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log(`🔐 PORT: ${process.env.PORT || 'not set'}`);

// 🔥 CEK JWT_SECRET
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === '') {
    console.error('❌ JWT_SECRET tidak ditemukan atau kosong!');
    console.error('⚠️  Menggunakan fallback untuk development...');
    
    // 🔥 Fallback untuk development
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
        process.env.JWT_SECRET = 'dev_secret_key_12345_for_testing_only';
        console.warn('⚠️  DEVELOPMENT MODE: Menggunakan fallback JWT_SECRET');
        console.warn('⚠️  JANGAN gunakan ini di production!');
    } else {
        console.error('❌ Production mode: JWT_SECRET wajib diisi!');
        console.error('❌ Aplikasi akan berhenti...');
        process.exit(1);
    }
} else {
    console.log('✅ JWT_SECRET: TERBACA');
    console.log(`✅ JWT_SECRET length: ${JWT_SECRET.length} characters`);
}

// 🔥 CEK DATABASE
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
};

console.log('\n📊 Database Configuration:');
console.log(`   Host: ${dbConfig.host || '❌ MISSING'}`);
console.log(`   User: ${dbConfig.user || '❌ MISSING'}`);
console.log(`   Database: ${dbConfig.database || '❌ MISSING'}`);
console.log(`   Port: ${dbConfig.port || '❌ MISSING'}`);

const dbMissing = Object.values(dbConfig).some(v => !v);
if (dbMissing) {
    console.error('❌ ERROR: Database configuration tidak lengkap!');
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
}

console.log('================================================\n');

const app = express();

// =============================================
// 2. UPLOAD CONFIGURATION
// =============================================
const UPLOAD_BASE_PATH = process.env.UPLOAD_PATH ||
    (process.env.NODE_ENV === 'production' ? '/app/uploads' : path.join(__dirname, 'uploads'));

const PROFILES_PATH = path.join(UPLOAD_BASE_PATH, 'profiles');
const CERTIFICATES_PATH = path.join(UPLOAD_BASE_PATH, 'certificates');

console.log(`\n📁 ========== UPLOAD CONFIGURATION ==========`);
console.log(`📁 NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`📁 UPLOAD_PATH: ${process.env.UPLOAD_PATH || 'NOT SET'}`);
console.log(`📁 UPLOAD_BASE_PATH: ${UPLOAD_BASE_PATH}`);
console.log(`============================================\n`);

// Buat folder jika belum ada
[UPLOAD_BASE_PATH, PROFILES_PATH, CERTIFICATES_PATH].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
    }
});

// =============================================
// 3. MIDDLEWARE KEAMANAN & KONFIGURASI
// =============================================

// Helmet Security
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
}));

// CORS Configuration
const allowedOrigins = [
    'http://localhost:8081',
    'http://localhost:8082',
    'http://localhost:3000',
    'http://localhost:5000',
    'https://myrts.netlify.app',
    'https://mitrarts.netlify.app',
    'https://admin-rts.netlify.app',
    'https://api.siappgo.id',
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            console.warn(`⚠️ CORS blocked origin: ${origin}`);
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

// Static Files
app.use('/uploads', express.static(UPLOAD_BASE_PATH));

// =============================================
// 4. ROUTES
// =============================================
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const mitraRoutes = require('./src/routes/mitraRoutes');
const walletRoutes = require('./src/routes/walletRoutes');
const serviceRoutes = require('./src/routes/serviceRoutes');
const deviceTokenRoutes = require('./src/routes/deviceTokenRoutes');
const escrowRoutes = require('./src/routes/escrowRoutes');
const voucherRoutes = require('./src/routes/voucherRoutes');
const voucherPublicRoutes = require('./src/routes/voucherPublicRoutes');

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/mitra', mitraRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/services', serviceRoutes);
app.use('/api/v1/devices', deviceTokenRoutes);
app.use('/api/v1/escrow', escrowRoutes);
app.use('/api/v1/admin/vouchers', voucherRoutes);
app.use('/api/customer/vouchers', voucherPublicRoutes);

// =============================================
// 5. ROOT HEALTH CHECK
// =============================================
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: "Bone & Joint Massage API",
        env: process.env.NODE_ENV,
        version: "1.0.0",
        jwt_configured: !!process.env.JWT_SECRET,
        features: {
            escrow_auto_release: "active",
            notification: "active",
            wallet: "active"
        }
    });
});

// =============================================
// 6. 404 & ERROR HANDLER
// =============================================

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

// =============================================
// 7. SERVER INITIALIZATION
// =============================================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`
    ════════════════════════════════════════════════
    🚀 Server berjalan di port: ${PORT}
    🛠️  Mode: ${process.env.NODE_ENV || 'development'}
    📅 Time: ${new Date().toLocaleString('id-ID')}
    🔐 JWT: ${process.env.JWT_SECRET ? '✅ Terkonfigurasi' : '❌ TIDAK ADA!'}
    📁 Uploads directory: ${UPLOAD_BASE_PATH}
    ════════════════════════════════════════════════
    `);
});

// =============================================
// 8. GRACEFUL SHUTDOWN
// =============================================

const gracefulShutdown = async () => {
    console.log('🛑 Received shutdown signal, closing server...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });

    setTimeout(() => {
        console.error('⚠️ Force shutting down after timeout');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

process.on('unhandledRejection', (err) => {
    console.log('❌ UNHANDLED REJECTION! 💥');
    console.log(err.name, err.message);
    console.log(err.stack);
});

process.on('uncaughtException', (err) => {
    console.log('❌ UNCAUGHT EXCEPTION! 💥');
    console.log(err.name, err.message);
    console.log(err.stack);
});

module.exports = app;