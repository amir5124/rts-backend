// app.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

// =============================================
// 1. LOAD ENVIRONMENT VARIABLES
// =============================================
dotenv.config();

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
console.log(`📁 UPLOAD_PATH env: ${process.env.UPLOAD_PATH || 'NOT SET'}`);
console.log(`📁 UPLOAD_BASE_PATH: ${UPLOAD_BASE_PATH}`);
console.log(`📁 PROFILES_PATH: ${PROFILES_PATH}`);
console.log(`📁 CERTIFICATES_PATH: ${CERTIFICATES_PATH}`);
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
console.log(`📁 Static files served from: ${UPLOAD_BASE_PATH}`);
console.log(`📁 Access via: /uploads/`);

// Endpoint untuk cek file (debugging)
app.get('/uploads/check/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(PROFILES_PATH, filename);

    console.log(`🔍 Checking file: ${filepath}`);

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

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/mitra', mitraRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/services', serviceRoutes);
app.use('/api/v1/devices', deviceTokenRoutes);
app.use('/api/v1/escrow', escrowRoutes);

// =============================================
// 5. ROOT HEALTH CHECK
// =============================================
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: "Bone & Joint Massage API",
        env: process.env.NODE_ENV,
        version: "1.0.0",
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
// 7. CRONJOB - ESCROW AUTO RELEASE (DIPERBAIKI)
// =============================================
let escrowCronJob = null;
let isCronRunning = false;

const startEscrowCron = () => {
    try {
        // Cek apakah cron sudah di-start
        if (isCronRunning) {
            console.log('⚠️ Escrow cron job already running, skipping...');
            return;
        }

        // 🔥 Cek apakah node-cron terinstall
        let cron;
        try {
            cron = require('node-cron');
        } catch (e) {
            console.log('⚠️ node-cron not installed, escrow auto-release disabled');
            console.log('💡 Install with: npm install node-cron');
            return;
        }

        const EscrowService = require('./src/services/escrowService');

        // 🔥 Jalankan setiap 5 menit
        escrowCronJob = cron.schedule('*/5 * * * *', async () => {
            console.log(`🔄 [${new Date().toISOString()}] Running escrow auto-release check...`);

            try {
                const result = await EscrowService.processAutoRelease();
                if (result.processed > 0) {
                    console.log(`✅ Escrow auto-release completed: ${result.processed} orders processed`);
                }
            } catch (error) {
                console.error('❌ Escrow auto-release error:', error.message);
            }
        });

        isCronRunning = true;
        console.log(`✅ Escrow cron job started (every 5 minutes)`);

        // 🔥 Tampilkan next run dengan cara aman (FIX: nextDate error)
        try {
            // node-cron v3+ menggunakan getNextDate()
            if (typeof escrowCronJob.getNextDate === 'function') {
                const nextDate = escrowCronJob.getNextDate();
                console.log(`📅 Next run: ${nextDate ? nextDate.toISOString() : 'unknown'}`);
            } else {
                console.log(`📅 Cron job scheduled (next run in ~5 minutes)`);
            }
        } catch (e) {
            console.log(`📅 Cron job scheduled (next run in ~5 minutes)`);
        }

        // 🔥 Jalankan sekali saat startup (setelah 5 detik)
        setTimeout(async () => {
            console.log(`🔄 [STARTUP] Running initial escrow check...`);
            try {
                const EscrowService = require('./src/services/escrowService');
                const result = await EscrowService.processAutoRelease();
                console.log(`✅ Initial escrow check completed: ${result.processed || 0} orders processed`);
            } catch (error) {
                console.error('❌ Initial escrow check error:', error.message);
            }
        }, 5000);

    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') {
            console.log('⚠️ node-cron not installed, escrow auto-release disabled');
            console.log('💡 Install with: npm install node-cron');
        } else {
            console.error('❌ Failed to start escrow cron job:', error.message);
        }
    }
};

// =============================================
// 8. SERVER INITIALIZATION
// =============================================
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`
    =============================================
    🚀 Server berjalan di port: ${PORT}
    🛠️  Mode: ${process.env.NODE_ENV || 'development'}
    📅 Time: ${new Date().toLocaleString('id-ID')}
    📁 Uploads directory: ${UPLOAD_BASE_PATH}
    📁 Profiles directory: ${PROFILES_PATH}
    📁 Certificates directory: ${CERTIFICATES_PATH}
    =============================================
    `);

    // 🔥 Start Escrow Cron Job
    startEscrowCron();
});

// =============================================
// 9. GRACEFUL SHUTDOWN
// =============================================

const gracefulShutdown = async () => {
    console.log('🛑 Received shutdown signal, closing server...');

    // Stop cron job
    if (escrowCronJob) {
        try {
            escrowCronJob.stop();
            console.log('✅ Escrow cron job stopped');
        } catch (error) {
            console.error('❌ Error stopping cron job:', error.message);
        }
    }

    // Close server
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
        console.error('⚠️ Force shutting down after timeout');
        process.exit(1);
    }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle Unhandled Rejections
process.on('unhandledRejection', (err) => {
    console.log('❌ UNHANDLED REJECTION! 💥');
    console.log(err.name, err.message);
    console.log(err.stack);
    // Keep server running, but log error
});

// Handle Uncaught Exceptions
process.on('uncaughtException', (err) => {
    console.log('❌ UNCAUGHT EXCEPTION! 💥');
    console.log(err.name, err.message);
    console.log(err.stack);
    // Keep server running, but log error
});

module.exports = app;