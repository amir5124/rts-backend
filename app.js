const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');

// 1. Load environment variables paling awal
dotenv.config();

const app = express();

// --- MIDDLEWARE KEAMANAN & KONFIGURASI ---

// 2. Helmet (PENTING: Konfigurasi agar tidak bentrok dengan CORS/Images)
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Lebih aman daripada false, tapi tetap izinkan akses luar
    contentSecurityPolicy: false, // Matikan jika frontend sering terblokir saat development
}));

// 3. CORS (Robust Configuration)
const allowedOrigins = [
    'http://localhost:8081', // Expo Web
    'http://localhost:8082', // Expo Go Web
    'https://myrts.netlify.app', // Expo Go Web
    'https://mitrarts.netlify.app', // Expo Go Web
    'https://api.siappgo.id',  // Production Domain
];

app.use(cors({
    origin: function (origin, callback) {
        // Izinkan request tanpa origin (seperti Mobile App atau Postman)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true // Izinkan jika kamu menggunakan cookies/sessions
}));

// 4. Logger
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

// 5. Body Parsers (Batasi ukuran payload untuk mencegah DOS)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 6. Static Files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- ROUTES ---

const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const mitraRoutes = require('./src/routes/mitraRoutes');
const walletRoutes = require('./src/routes/walletRoutes');
const serviceRoutes = require('./src/routes/serviceRoutes');
const deviceTokenRoutes = require('./src/routes/deviceTokenRoutes')

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

// --- ERROR HANDLING ---

// 404 Handler
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        message: `Endpoint ${req.originalUrl} tidak ditemukan`
    });
});

// Global Error Handler (Centralized)
app.use((err, req, res, next) => {
    // Tambahkan header CORS pada error response agar browser tidak menampilkan "CORS Error" saat server crash
    res.header("Access-Control-Allow-Origin", req.headers.origin || "*");

    console.error('🔥 Error Stack:', err.stack);

    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        success: false,
        message: err.message || "Internal Server Error",
        // Hanya tampilkan stack trace di mode development
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
    =============================================
    `);
});

// Handle Unhandled Rejections (Robustness)
process.on('unhandledRejection', (err) => {
    console.log('UNHANDLED REJECTION! 💥 Shutting down...');
    console.log(err.name, err.message);
    server.close(() => {
        process.exit(1);
    });
});