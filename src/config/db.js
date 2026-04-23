const mysql = require('mysql2');
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
    queueLimit: 0
});

// Tambahkan logika pengecekan koneksi di sini
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Database connection failed!');
        console.error('Detail Error:', err.message);
        
        // Opsional: Jika database mati, kita bisa menghentikan server
        // process.exit(1); 
    } else {
        console.log('✅ Database connected successfully to: ' + process.env.DB_NAME);
        connection.release(); // Sangat penting untuk melepas koneksi kembali ke pool
    }
});

module.exports = pool.promise();