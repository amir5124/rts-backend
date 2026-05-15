const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import Routes
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const mitraRoutes = require('./src/routes/mitraRoutes');

// Import Cron Jobs (Otomatis berjalan saat server start)
// require('./src/jobs/escrowJob');

const app = express();


// Helmet membantu mengamankan Express app dengan menetapkan berbagai header HTTP
app.use(helmet({
    crossOriginResourcePolicy: false, // Izinkan gambar diakses oleh Expo/Frontend
}));

// Mengizinkan permintaan dari origin berbeda (sangat penting untuk Expo)
app.use(cors());

// Log request ke console (Development mode)
app.use(morgan('dev'));

// Parsing Body (JSON & URL-encoded)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Agar file di folder uploads bisa diakses via URL, misal: http://localhost:5000/uploads/profiles/foto.jpg
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/mitra', mitraRoutes);

// Root URL untuk pengecekan status server
app.get('/', (req, res) => {
    res.status(200).json({
        message: "Welcome to Bone & Joint Massage API",
        status: "Server is Running",
        version: "1.0.0"
    });
});


// Handle Route yang tidak ditemukan
app.use((req, res, next) => {
    res.status(404).json({
        status: false,
        message: "Endpoint tidak ditemukan"
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        status: false,
        message: err.message || "Internal Server Error"
    });
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`
    =============================================
    🚀 Server berjalan di: http://localhost:${PORT}
    🛠️  Mode: Development
    📅 Time: ${new Date().toLocaleString('id-ID')}
    =============================================
    `);
});