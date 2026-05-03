const mysql = require('mysql2/promise'); // Langsung gunakan versi promise
const dotenv = require('dotenv');
dotenv.config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Tambahkan ini untuk memutus koneksi yang idle secara otomatis di sisi client
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000 
});

// Gunakan async/await untuk pengecekan koneksi agar konsisten
(async () => {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully to: ' + process.env.DB_NAME);
        connection.release(); // Melepas koneksi kembali ke pool
    } catch (err) {
        console.error('❌ Database connection failed!');
        console.error('Detail Error:', err.message);
    }
})();

module.exports = pool;