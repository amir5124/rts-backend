const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// CREATE voucher
exports.createVoucher = async (req, res) => {
    try {
        const {
            code, title, description, discount_type, discount_value,
            max_discount_amount, min_transaction, quota, max_use_per_user,
            applicable_service_id, applicable_role, start_date, end_date, status
        } = req.body;

        if (!code || !title || !discount_type || !discount_value || !start_date || !end_date) {
            return res.status(400).json({ success: false, message: 'Field wajib belum lengkap' });
        }

        const [existing] = await db.query('SELECT id FROM vouchers WHERE code = ?', [code]);
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'Kode voucher sudah digunakan' });
        }

        const image = req.file ? req.file.filename : null;

        const [result] = await db.query(
            `INSERT INTO vouchers 
            (code, title, description, image, discount_type, discount_value, max_discount_amount, min_transaction, quota, max_use_per_user, applicable_service_id, applicable_role, start_date, end_date, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                code, title, description || null, image, discount_type, discount_value,
                max_discount_amount || null, min_transaction || 0, quota || null,
                max_use_per_user || 1, applicable_service_id || null,
                applicable_role || 'customer', start_date, end_date,
                status || 'active', req.user?.id || null
            ]
        );

        return res.status(201).json({ success: true, message: 'Voucher berhasil dibuat', data: { id: result.insertId, image } });
    } catch (err) {
        console.error('createVoucher error:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
};
// READ - semua voucher (dengan filter & pagination)
exports.getAllVouchers = async (req, res) => {
    try {
        const { status, page = 1, limit = 10, search } = req.query;
        const offset = (page - 1) * limit;

        let where = 'WHERE 1=1';
        const params = [];

        if (status) {
            where += ' AND status = ?';
            params.push(status);
        }
        if (search) {
            where += ' AND (code LIKE ? OR title LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        const [rows] = await db.query(
            `SELECT * FROM vouchers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...params, Number(limit), Number(offset)]
        );

        const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM vouchers ${where}`, params);

        return res.json({
            success: true,
            data: rows,
            pagination: {
                total: countRows[0].total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(countRows[0].total / limit)
            }
        });
    } catch (err) {
        console.error('getAllVouchers error:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
};

// READ - detail voucher by id
exports.getVoucherById = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT * FROM vouchers WHERE id = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Voucher tidak ditemukan' });
        }

        return res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('getVoucherById error:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
};

// UPDATE voucher
exports.updateVoucher = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            title, description, discount_type, discount_value,
            max_discount_amount, min_transaction, quota, max_use_per_user,
            applicable_service_id, applicable_role, start_date, end_date, status
        } = req.body;

        const [existing] = await db.query('SELECT * FROM vouchers WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Voucher tidak ditemukan' });
        }

        let image = existing[0].image;
        if (req.file) {
            // hapus file lama kalau ada
            if (image) {
                const oldPath = path.join(__dirname, '../../public/uploads/vouchers', image);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            image = req.file.filename;
        }

        await db.query(
            `UPDATE vouchers SET
                title = ?, description = ?, image = ?, discount_type = ?, discount_value = ?,
                max_discount_amount = ?, min_transaction = ?, quota = ?, max_use_per_user = ?,
                applicable_service_id = ?, applicable_role = ?, start_date = ?, end_date = ?, status = ?
            WHERE id = ?`,
            [
                title, description || null, image, discount_type, discount_value,
                max_discount_amount || null, min_transaction || 0, quota || null,
                max_use_per_user || 1, applicable_service_id || null,
                applicable_role || 'customer', start_date, end_date, status, id
            ]
        );

        return res.json({ success: true, message: 'Voucher berhasil diperbarui', data: { image } });
    } catch (err) {
        console.error('updateVoucher error:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
};

// DELETE voucher (soft delete default, hard delete jika ?hard=true)
exports.deleteVoucher = async (req, res) => {
    try {
        const { id } = req.params;
        const { hard } = req.query;

        const [existing] = await db.query('SELECT id FROM vouchers WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Voucher tidak ditemukan' });
        }

        if (hard === 'true') {
            await db.query('DELETE FROM vouchers WHERE id = ?', [id]);
            return res.json({ success: true, message: 'Voucher berhasil dihapus permanen' });
        }

        await db.query('UPDATE vouchers SET status = ? WHERE id = ?', ['inactive', id]);
        return res.json({ success: true, message: 'Voucher berhasil dinonaktifkan' });
    } catch (err) {
        console.error('deleteVoucher error:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
};

// GET riwayat pemakaian voucher tertentu (untuk admin dashboard)
exports.getVoucherUsages = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query(
            `SELECT vu.*, u.name AS user_name, u.email 
             FROM voucher_usages vu
             JOIN users u ON u.id = vu.user_id
             WHERE vu.voucher_id = ?
             ORDER BY vu.used_at DESC`,
            [id]
        );
        return res.json({ success: true, data: rows });
    } catch (err) {
        console.error('getVoucherUsages error:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
};