const LinkQu = require('../utils/linkqu');
const moment = require('moment-timezone');
const db = require('../config/db');

const PaymentController = {
    requestPaymentGateway: async (payload, tx = null) => {
        const { order_id, order_code, amount, customer, method, bank_code } = payload;
        const client = tx || db;

        try {
            const partner_reff = `PAY-ORD-${order_code}`;
            const expired = moment.tz('Asia/Jakarta').add(2, 'hours').format('YYYYMMDDHHmmss');
            
            // Siapkan data untuk Helper LinkQu
            const linkquData = {
                amount: Math.round(Number(amount)),
                expired,
                partner_reff,
                bank_code,
                method,
                customer_id: customer.phone.replace(/[^0-9]/g, ''), // Pakai HP sebagai ID
                customer_name: (customer.name || 'Customer').substring(0, 30),
                customer_email: customer.email || 'guest@mail.com',
                customer_phone: customer.phone,
                url_callback: "https://api.siappgo.id/api/payments/callback"
            };

            // PANGGIL HELPER
            let resp;
            if (method === 'VA') {
                resp = await LinkQu.createVA(linkquData);
            } else {
                resp = await LinkQu.createQRIS(linkquData);
            }

            const result = resp.data;
            console.log(result,"tt")

            // PROTEKSI: Jika LinkQu gagal (Signature Not Valid, dll)
            if (result.status === 'FAILED' || result.response_code !== '200') {
                throw new Error(`LinkQu: ${result.response_desc || 'Payment Failed'}`);
            }

            // Ambil data bayar dari response
            const vaNumber = result.virtual_account || result.va_number || result.data?.va_number;
            const qrisUrl = result.imageqris || result.qr_url || result.data?.qr_url;

            // Simpan ke DB
            const mysqlExpired = moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss');
            await client.query(
                `INSERT INTO payments (order_id, partner_reff, method, bank_code, va_number, qris_url, amount, status, expired_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
                [order_id, partner_reff, method, bank_code, vaNumber, qrisUrl, linkquData.amount, mysqlExpired]
            );

            return { vaNumber, qrisUrl, partner_reff };

        } catch (error) {
            console.error("❌ Payment Gateway Error:", error.message);
            // Re-throw supaya OrderController bisa ROLLBACK database
            throw error;
        }
    },

    handleCallback: async (req, res) => {
        console.log("📥 [CALLBACK RECEIVED]:", req.body);
        const { partner_reff, status } = req.body;
        const statusUpper = status?.toUpperCase();

        if (statusUpper === "SUCCESS" || statusUpper === "SETTLED") {
            try {
                const [rows] = await db.query("SELECT order_id FROM payments WHERE partner_reff = ?", [partner_reff]);
                if (rows.length > 0) {
                    const orderId = rows[0].order_id;
                    
                    // Gunakan Transaction untuk update ganda
                    const connection = await db.getConnection();
                    await connection.beginTransaction();
                    try {
                        await connection.query("UPDATE payments SET status = 'SUCCESS', paid_at = NOW() WHERE partner_reff = ?", [partner_reff]);
                        await connection.query("UPDATE orders SET status = 'paid' WHERE id = ?", [orderId]);
                        await connection.commit();
                        console.log(`✅ Order ${orderId} lunas via Callback.`);
                    } catch (err) {
                        await connection.rollback();
                        throw err;
                    } finally {
                        connection.release();
                    }
                }
            } catch (err) {
                console.error("❌ Callback DB Error:", err.message);
            }
        }
        return res.json({ message: "OK" });
    }
};

module.exports = PaymentController;