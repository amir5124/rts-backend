const LinkQu = require('../utils/linkqu');
const moment = require('moment-timezone');
const db = require('../config/db');
const notificationService = require('../services/notificationService'); // 🔥 TAMBAHKAN

const PaymentController = {
    /**
     * REQUEST PEMBAYARAN KE GATEWAY
     */
    requestPaymentGateway: async (payload, tx = null) => {
        // 🔥 Terima partner_reff dari parameter (TIDAK dibuat baru)
        const { order_id, order_code, partner_reff, amount, customer, method, bank_code } = payload;
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

            // 🔥 Gunakan partner_reff dari parameter, JANGAN buat baru
            const expired = moment.tz('Asia/Jakarta').add(2, 'hours').format('YYYYMMDDHHmmss');

            let phone = (customer.phone || '081234567890').replace(/[^0-9]/g, '');
            if (phone.startsWith('0')) phone = '62' + phone.substring(1);
            if (phone.length < 10) phone = '628123456789';

            const linkquData = {
                amount: Math.round(Number(amount)),
                expired,
                partner_reff: partner_reff, // 🔥 Gunakan dari parameter
                bank_code: finalBankCode,
                method: method,
                customer_id: String(customer.id || phone),
                customer_name: (customer.name || 'Customer').substring(0, 30),
                customer_email: customer.email || 'guest@mail.com',
                customer_phone: phone,
                url_callback: "https://api.siappgo.id/api/v1/payments/callback"
            };

            console.log(`[Payment] 🚀 Requesting payment with partner_reff: ${partner_reff}`);

            let result;
            if (method && method.toUpperCase().includes('VA')) {
                result = await LinkQu.createVA(linkquData);
            } else {
                result = await LinkQu.createQRIS(linkquData);
            }

            const isSuccess = result?.response_code === '200' || result?.status === 'SUCCESS';
            if (!isSuccess) {
                throw new Error(`LinkQu: ${result?.response_desc || "Koneksi Gagal"}`);
            }

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
            console.error("[Payment] ❌ Error requestPaymentGateway:", error.message);
            throw error;
        }
    },

    /**
     * HANDLE CALLBACK DARI LINKQU
     * 🔥 DITAMBAHKAN NOTIFIKASI KE MITRA & CUSTOMER SAAT PAYMENT SUCCESS
     */
    handleCallback: async (req, res) => {
        console.log("📥 [CALLBACK] Incoming:", JSON.stringify(req.body, null, 2));

        let connection;
        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const { partner_reff, status, response_code, transaction_time } = req.body;
            const isSuccess = status === "SUCCESS" || status === "SETTLED" || response_code === "00";

            const [payments] = await connection.query(
                `SELECT p.order_id, o.mitra_id, o.customer_id, o.order_code, o.total_amount,
                        s.service_name, c.name as customer_name, m.name as mitra_name
                 FROM payments p
                 LEFT JOIN orders o ON p.order_id = o.id
                 LEFT JOIN services s ON o.service_id = s.id
                 LEFT JOIN users c ON o.customer_id = c.id
                 LEFT JOIN users m ON o.mitra_id = m.id
                 WHERE p.partner_reff = ?`,
                [partner_reff]
            );

            if (payments.length === 0) {
                await connection.rollback();
                return res.status(200).json({ status: "SUCCESS" });
            }

            const orderId = payments[0].order_id;
            const mitraId = payments[0].mitra_id;
            const customerId = payments[0].customer_id;
            const orderCode = payments[0].order_code;
            const serviceName = payments[0].service_name;
            const customerName = payments[0].customer_name;
            const totalAmount = payments[0].total_amount;

            // 🔥 UPDATE TANPA updated_at
            await connection.query(
                `UPDATE payments SET payload_callback = ?, payload_response = ? WHERE partner_reff = ?`,
                [JSON.stringify(req.body), JSON.stringify(req.body), partner_reff]
            );

            if (isSuccess) {
                await connection.query(
                    `UPDATE payments SET status = 'SUCCESS', paid_at = ? WHERE partner_reff = ?`,
                    [transaction_time || new Date(), partner_reff]
                );

                await connection.query(
                    `UPDATE orders SET status = 'paid' WHERE id = ?`,
                    [orderId]
                );

                await connection.commit();
                console.log(`✅ [CALLBACK] Success. Order ${orderId} UPDATED.`);

                if (mitraId) {
                    notificationService.sendNewOrderNotificationToMitra(
                        mitraId, orderId, customerName, serviceName, orderCode
                    ).catch(err => console.error('Notif error:', err.message));
                }

                if (customerId) {
                    notificationService.sendPaymentSuccessNotificationToCustomer(
                        customerId, orderId, orderCode, totalAmount
                    ).catch(err => console.error('Notif error:', err.message));
                }
            } else {
                await connection.commit();
            }

            return res.status(200).json({ status: "SUCCESS" });

        } catch (err) {
            if (connection) await connection.rollback();
            console.error("❌ [CALLBACK ERROR]:", err.message);
            return res.status(500).json({ status: "ERROR", message: err.message });
        } finally {
            if (connection) connection.release();
        }
    },
    // controllers/PaymentController.js - Update fungsi checkStatus

    /**
     * CHECK STATUS (POLLING DARI FRONTEND)
     * 🔥 PERBAIKAN: Menggunakan GET method seperti project lain
     */
    // controllers/PaymentController.js
    checkStatus: async (req, res) => {
        let { reff } = req.params;

        if (!reff) {
            return res.status(400).json({
                status: 'ERROR',
                message: 'Parameter reff tidak ditemukan'
            });
        }

        try {
            // 🔥 KRUSIAL: Cari partner_reff yang benar dari database
            // Karena reff bisa dalam format ORD-xxx atau PAY-xxx
            const [payments] = await db.query(
                `SELECT p.partner_reff, p.status, p.order_id, o.order_code
             FROM payments p
             LEFT JOIN orders o ON p.order_id = o.id
             WHERE p.partner_reff = ? 
                OR p.partner_reff = CONCAT('PAY-', ?)
                OR o.order_code = ?
                OR p.partner_reff LIKE CONCAT('%', REPLACE(?, 'ORD-', ''))
             LIMIT 1`,
                [reff, reff, reff, reff]
            );

            let partnerReff = reff;
            let orderCode = reff;

            if (payments.length > 0) {
                partnerReff = payments[0].partner_reff;
                orderCode = payments[0].order_code || reff;
                const paymentStatus = payments[0].status?.toUpperCase() || '';

                console.log(`📝 Found in DB: partner_reff=${partnerReff}, status=${paymentStatus}`);

                if (['SUCCESS', 'SETTLED', 'PAID'].includes(paymentStatus)) {
                    return res.json({
                        status: 'SUCCESS',
                        message: 'Pembayaran sudah lunas',
                        data: { payment_status: paymentStatus }
                    });
                }
            }

            // 🔥 PERBAIKAN: Gunakan partner_reff yang benar dari database
            // Jika masih ORD-xxx, konversi ke PAY-xxx
            let linkQuReff = partnerReff;
            if (linkQuReff.startsWith('ORD-')) {
                linkQuReff = `PAY-${linkQuReff}`;
                console.log(`🔄 Converted reff for LinkQu: ${partnerReff} -> ${linkQuReff}`);
            }

            console.log(`🔍 [POLLING] Checking status with LinkQu reff: ${linkQuReff}`);

            // Panggil LinkQu dengan reff yang benar
            const vendorResult = await LinkQu.checkStatus(linkQuReff);

            console.log(`[LinkQu] Status check result:`, vendorResult);

            const responseCode = vendorResult?.rc || vendorResult?.response_code || '';
            const isSuccess = responseCode === '00' || responseCode === '200';
            const transactionFound = vendorResult?.total > 0 ||
                vendorResult?.status === 'SUCCESS' ||
                Object.keys(vendorResult?.data || {}).length > 0;

            if (isSuccess && transactionFound && payments.length > 0) {
                // Update database
                await db.query(
                    `UPDATE payments SET status = 'SUCCESS', paid_at = NOW(), updated_at = NOW() 
                 WHERE partner_reff = ?`,
                    [partnerReff]
                );

                if (payments[0].order_id) {
                    await db.query(
                        `UPDATE orders SET status = 'paid', updated_at = NOW() 
                     WHERE id = ?`,
                        [payments[0].order_id]
                    );
                }

                return res.json({
                    status: 'SUCCESS',
                    message: 'Pembayaran Berhasil',
                    data: vendorResult
                });
            }

            return res.json({
                status: 'PENDING',
                message: vendorResult?.rd || 'Menunggu pembayaran',
                data: vendorResult
            });

        } catch (err) {
            console.error(`❌ [CHECK STATUS ERROR]:`, err.message);
            return res.status(500).json({
                status: 'ERROR',
                message: 'Terjadi kesalahan saat mengecek status'
            });
        }
    },

    /**
     * GET PAYMENT DETAIL
     */
    getPaymentDetail: async (req, res) => {
        const { order_id } = req.params;

        try {
            const [rows] = await db.query(
                `SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
                [order_id]
            );

            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Data pembayaran tidak ditemukan'
                });
            }

            res.json({
                success: true,
                data: rows[0]
            });
        } catch (error) {
            console.error('❌ Get Payment Detail Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        }
    },

    /**
     * CANCEL PAYMENT
     */
    cancelPayment: async (req, res) => {
        const { payment_id } = req.params;

        try {
            // Cek payment status
            const [payments] = await db.query(
                `SELECT partner_reff, status FROM payments WHERE id = ?`,
                [payment_id]
            );

            if (payments.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Pembayaran tidak ditemukan'
                });
            }

            if (payments[0].status !== 'PENDING') {
                return res.status(400).json({
                    success: false,
                    message: `Pembayaran status ${payments[0].status} tidak dapat dibatalkan`
                });
            }

            // Panggil API cancel dari LinkQu
            let cancelResult = null;
            if (typeof LinkQu.cancelTransaction === 'function') {
                cancelResult = await LinkQu.cancelTransaction(payments[0].partner_reff);
            }

            // Update status di DB
            await db.query(
                `UPDATE payments SET status = 'CANCELLED', updated_at = NOW() WHERE id = ?`,
                [payment_id]
            );

            res.json({
                success: true,
                message: 'Pembayaran berhasil dibatalkan',
                data: cancelResult
            });
        } catch (error) {
            console.error('❌ Cancel Payment Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        }
    }
};

module.exports = PaymentController;