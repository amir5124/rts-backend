const db = require('../config/db');

// GET daftar voucher aktif & masih berlaku (untuk halaman "Voucher Saya" / promo di app customer)
exports.getActiveVouchers = async (req, res) => {
    try {
        const { service_id } = req.query;

        let where = `WHERE status = 'active' AND NOW() BETWEEN start_date AND end_date
                      AND (quota IS NULL OR used_count < quota)
                      AND applicable_role IN ('all', 'customer')`;
        const params = [];

        if (service_id) {
            where += ' AND (applicable_service_id IS NULL OR applicable_service_id = ?)';
            params.push(service_id);
        } else {
            where += ' AND applicable_service_id IS NULL';
        }

        const [rows] = await db.query(
            `SELECT id, code, title, description, discount_type, discount_value, 
                    max_discount_amount, min_transaction, applicable_service_id, start_date, end_date
             FROM vouchers ${where}
             ORDER BY created_at DESC`,
            params
        );

        return res.json({ success: true, data: rows });
    } catch (err) {
        console.error('getActiveVouchers error:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
};

// POST cek & validasi voucher sebelum checkout (butuh login customer)
exports.checkVoucher = async (req, res) => {
    try {
        const { code, service_id, total_amount } = req.body;
        const userId = req.user?.id; // dari middleware verifyToken

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Silakan login terlebih dahulu' });
        }
        if (!code || !total_amount) {
            return res.status(400).json({ success: false, message: 'Kode voucher dan total_amount wajib diisi' });
        }

        const [vouchers] = await db.query(
            `SELECT * FROM vouchers 
             WHERE code = ? AND status = 'active' AND NOW() BETWEEN start_date AND end_date`,
            [code]
        );

        if (vouchers.length === 0) {
            return res.status(404).json({ success: false, message: 'Voucher tidak ditemukan atau sudah tidak berlaku' });
        }

        const voucher = vouchers[0];

        // Cek kuota
        if (voucher.quota !== null && voucher.used_count >= voucher.quota) {
            return res.status(400).json({ success: false, message: 'Kuota voucher sudah habis' });
        }

        // Cek berlaku untuk layanan tertentu
        if (voucher.applicable_service_id && Number(voucher.applicable_service_id) !== Number(service_id)) {
            return res.status(400).json({ success: false, message: 'Voucher tidak berlaku untuk layanan ini' });
        }

        // Cek minimal transaksi
        if (Number(total_amount) < Number(voucher.min_transaction)) {
            return res.status(400).json({
                success: false,
                message: `Minimal transaksi Rp${Number(voucher.min_transaction).toLocaleString('id-ID')} untuk memakai voucher ini`
            });
        }

        // Cek limit pemakaian per user
        const [usageRows] = await db.query(
            'SELECT COUNT(*) AS total FROM voucher_usages WHERE voucher_id = ? AND user_id = ?',
            [voucher.id, userId]
        );
        if (usageRows[0].total >= voucher.max_use_per_user) {
            return res.status(400).json({ success: false, message: 'Kamu sudah mencapai batas pemakaian voucher ini' });
        }

        // Hitung diskon
        let discountAmount = 0;
        if (voucher.discount_type === 'percentage') {
            discountAmount = (Number(total_amount) * Number(voucher.discount_value)) / 100;
            if (voucher.max_discount_amount) {
                discountAmount = Math.min(discountAmount, Number(voucher.max_discount_amount));
            }
        } else {
            discountAmount = Number(voucher.discount_value);
        }
        discountAmount = Math.min(discountAmount, Number(total_amount));

        return res.json({
            success: true,
            message: 'Voucher valid',
            data: {
                voucher_id: voucher.id,
                code: voucher.code,
                title: voucher.title,
                discount_type: voucher.discount_type,
                discount_amount: discountAmount,
                final_amount: Number(total_amount) - discountAmount
            }
        });
    } catch (err) {
        console.error('checkVoucher error:', err);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
};