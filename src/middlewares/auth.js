// src/middlewares/auth.js
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'rahasia_super_kuat_amir';

/**
 * 🔥 Middleware Verifikasi Token
 * Memverifikasi JWT token dari header Authorization
 */
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
            ignoreExpiration: true
        });

        req.user = decoded;

        // Cek user masih aktif di database
        const [rows] = await db.query(
            'SELECT id, name, email, phone, role, is_active FROM users WHERE id = ?',
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

        req.user = { ...req.user, ...rows[0] };
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Token tidak valid'
        });
    }
};

/**
 * 🔥 Middleware Cek Role Mitra
 */
const isMitra = (req, res, next) => {
    if (req.user.role !== 'mitra') {
        return res.status(403).json({
            success: false,
            message: 'Akses ditolak. Hanya untuk mitra.'
        });
    }
    next();
};

/**
 * 🔥 Middleware Cek Role Admin
 */
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Akses ditolak. Hanya untuk admin.'
        });
    }
    next();
};

/**
 * 🔥 Middleware Cek Role Customer
 */
const isCustomer = (req, res, next) => {
    if (req.user.role !== 'customer') {
        return res.status(403).json({
            success: false,
            message: 'Akses ditolak. Hanya untuk customer.'
        });
    }
    next();
};

/**
 * 🔥 Middleware Auth (alias dari verifyToken untuk kompatibilitas)
 */
const authMiddleware = verifyToken;

/**
 * 🔥 Middleware Admin Auth (verifyToken + isAdmin)
 */
const adminAuth = [verifyToken, isAdmin];

/**
 * 🔥 Middleware Mitra Auth (verifyToken + isMitra)
 */
const mitraAuth = [verifyToken, isMitra];

/**
 * 🔥 Middleware Customer Auth (verifyToken + isCustomer)
 */
const customerAuth = [verifyToken, isCustomer];

module.exports = {
    verifyToken,
    isMitra,
    isAdmin,
    isCustomer,
    authMiddleware,
    adminAuth,
    mitraAuth,
    customerAuth
};