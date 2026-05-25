const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    timezone: '+07:00',  // 🔥 WIB (UTC+7)
    dateStrings: true,    // Mengembalikan tanggal sebagai string
});

// Test koneksi
(async () => {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully to: ' + process.env.DB_NAME);
        connection.release();
    } catch (err) {
        console.error('❌ Database connection failed!');
        console.error('Detail Error:', err.message);
    }
})();

module.exports = pool;