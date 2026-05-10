const LinkQu = require('../utils/linkqu');
const moment = require('moment-timezone');
const db = require('../config/db');

const PaymentController = {
    // --- REQUEST PEMBAYARAN (EXISTING DENGAN PENYESUAIAN) ---
    requestPaymentGateway: async (payload, tx = null) => {
        const { order_id, order_code, amount, customer, method, bank_code } = payload;
        const client = tx || db;

        try {
            const bankMapping = {
                'va_bni': '009', 'bni': '009', 'BNI': '009',
                'va_bri': '002', 'bri': '002', 'BRI': '002',
                'va_mandiri': '008', 'mandiri': '008', 'MANDIRI': '008',
                'va_bca': '014', 'bca': '014', 'BCA': '014',
                'va_permata': '013', 'permata': '013', 'PERMATA': '013'
            };

            const rawBank = (bank_code || method || '').toLowerCase();
            const finalBankCode = bankMapping[rawBank] || '002';

            const partner_reff = `PAY-ORD-${order_code}`;
            const expired = moment.tz('Asia/Jakarta').add(2, 'hours').format('YYYYMMDDHHmmss');

            let phone = (customer.phone || '081234567890').replace(/[^0-9]/g, '');
            if (phone.startsWith('0')) phone = '62' + phone.substring(1);

            const linkquData = {
                amount: Math.round(Number(amount)),
                expired,
                partner_reff,
                bank_code: finalBankCode,
                method: method,
                customer_id: String(customer.id || phone),
                customer_name: (customer.name || 'Customer').substring(0, 30),
                customer_email: customer.email || 'guest@mail.com',
                customer_phone: phone,
                url_callback: "https://api.siappgo.id/api/payments/callback"
            };

            let result;
            if (method.toUpperCase().includes('VA')) {
                result = await LinkQu.createVA(linkquData);
            } else {
                result = await LinkQu.createQRIS(linkquData);
            }

            const isSuccess = result?.response_code === '200' || result?.status === 'SUCCESS';
            if (!isSuccess) throw new Error(`LinkQu: ${result?.response_desc || "Koneksi Gagal"}`);

            const vaNumber = result.data?.va_number || result.virtual_account || result.va_number || null;
            const qrisUrl = result.data?.qr_url || result.imageqris || result.qr_url || null;
            const mysqlExpired = moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss');

            await client.query(
                `INSERT INTO payments (
                    order_id, partner_reff, method, bank_code, 
                    va_number, qris_url, amount, status, 
                    expired_at, payload_request
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
                [
                    order_id, partner_reff, method, finalBankCode,
                    vaNumber, qrisUrl, linkquData.amount,
                    mysqlExpired, JSON.stringify(result)
                ]
            );

            return { vaNumber, qrisUrl, partner_reff };
        } catch (error) {
            console.error("[Payment] ❌ Error:", error.message);
            throw error;
        }
    },

    // --- HANDLE CALLBACK DARI LINKQU ---
    handleCallback: async (req, res) => {
        console.log("📥 [CALLBACK] Incoming:", JSON.stringify(req.body, null, 2));
        try {
            const { partner_reff, status } = req.body;
            const statusUpper = (status || "").toUpperCase();

            if (statusUpper === "SUCCESS" || statusUpper === "SETTLED") {
                // 1. Cari data payment di DB
                const [payments] = await db.query(
                    `SELECT order_id FROM payments WHERE partner_reff = ?`,
                    [partner_reff]
                );

                if (payments.length > 0) {
                    const orderId = payments[0].order_id;

                    // 2. Update Status Payment
                    await db.query(
                        `UPDATE payments SET status = 'SUCCESS', updated_at = NOW() WHERE partner_reff = ?`,
                        [partner_reff]
                    );

                    // 3. Update Status Order (Sesuaikan nama tabel order Anda)
                    await db.query(
                        `UPDATE orders SET status = 'PAID', updated_at = NOW() WHERE id = ?`,
                        [orderId]
                    );

                    console.log(`✅ [CALLBACK] Reff ${partner_reff} Success. Order ${orderId} UPDATED.`);
                } else {
                    console.warn(`⚠️ [CALLBACK] Reff ${partner_reff} not found.`);
                }
            }

            // LinkQu membutuhkan response OK agar tidak mengirim ulang callback
            return res.status(200).json({ status: "SUCCESS" });
        } catch (err) {
            console.error("❌ [CALLBACK ERROR]:", err.message);
            return res.status(500).json({ status: "ERROR" });
        }
    },

    // --- CHECK STATUS (POLLING DARI FRONTEND) ---
    checkStatus: async (req, res) => {
        const { reff } = req.params;
        try {
            // 1. Cek Database Lokal Terlebih Dahulu
            const [rows] = await db.query(
                `SELECT p.status as payment_status, o.status as order_status 
                 FROM payments p
                 LEFT JOIN orders o ON p.order_id = o.id
                 WHERE p.partner_reff = ?`,
                [reff]
            );

            if (rows.length > 0) {
                const status = rows[0].payment_status.toUpperCase();
                if (['SUCCESS', 'SETTLED', 'PAID'].includes(status)) {
                    return res.json({
                        status: 'SUCCESS',
                        message: 'Pembayaran sudah lunas (Verified by DB)'
                    });
                }
            }

            // 2. Jika di DB masih PENDING, Tanya ke Vendor (LinkQu)
            console.log(`🔍 [POLLING] Checking Vendor for Reff: ${reff}`);
            const result = await LinkQu.checkStatus(reff); // Pastikan util LinkQu Anda punya fungsi checkStatus

            const isSuccess =
                (result?.status && (result.status.toUpperCase() === 'SUCCESS' || result.status.toUpperCase() === 'SETTLED')) ||
                (result?.response_code === '00' || result?.response_code === '200');

            if (isSuccess) {
                // 3. Jika Vendor bilang OK, Update DB (Antisipasi callback telat)
                const orderId = rows[0]?.order_id;
                await db.query(
                    `UPDATE payments SET status = 'SUCCESS', updated_at = NOW() WHERE partner_reff = ?`,
                    [reff]
                );
                if (orderId) {
                    await db.query(`UPDATE orders SET status = 'PAID' WHERE id = ?`, [orderId]);
                }

                return res.json({ status: 'SUCCESS', message: 'Pembayaran Berhasil' });
            }

            return res.json({ status: 'PENDING', message: 'Menunggu pembayaran' });

        } catch (err) {
            console.error(`❌ [CHECK STATUS ERROR]:`, err.message);
            return res.json({ status: 'PENDING', error: err.message });
        }
    }
};

module.exports = PaymentController;