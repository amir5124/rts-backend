const jwt = require('jsonwebtoken');
const db = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'rahasia_super_kuat_amir';

const verifyToken = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Akses ditolak. Silakan login kembali.'
        });
    }

    try {
        // Verify tanpa cek expired
        const decoded = jwt.verify(token, JWT_SECRET, {
            ignoreExpiration: true  // Abaikan expired jika ada
        });

        req.user = decoded;

        // Cek user masih aktif di database
        const [rows] = await db.query(
            'SELECT id, role, is_active FROM users WHERE id = ?',
            [decoded.id]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'User tidak ditemukan'
            });
        }

        if (!rows[0].is_active) {
            return res.status(401).json({
                success: false,
                message: 'Akun Anda telah dinonaktifkan oleh admin'
            });
        }

        req.user.role = rows[0].role;
        next();
    } catch (error) {
        // Token tetap valid meskipun error (kecuali signature salah)
        return res.status(401).json({
            success: false,
            message: 'Token tidak valid'
        });
    }
};

const isMitra = (req, res, next) => {
    if (req.user.role !== 'mitra') {
        return res.status(403).json({
            success: false,
            message: 'Akses ditolak. Hanya untuk mitra.'
        });
    }
    next();
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Akses ditolak. Hanya untuk admin.'
        });
    }
    next();
};

module.exports = { verifyToken, isMitra, isAdmin };