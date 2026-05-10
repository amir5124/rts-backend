const LinkQu = require('../utils/linkqu');
const moment = require('moment-timezone');
const db = require('../config/db');

const PaymentController = {
    requestPaymentGateway: async (payload, tx = null) => {
        // Destructuring dari payload frontend
        // Note: Payload asli Anda memiliki payment_info.method = "va_bni"
        const { order_id, order_code, amount, customer, method, bank_code } = payload;
        const client = tx || db;

        // --- LOG DATA DARI FRONTEND ---
        console.log(`[Frontend-In] 📥 Method: ${method}, BankCode: ${bank_code}, Order: ${order_code}`);

        try {
            const partner_reff = `PAY-ORD-${order_code}`;
            const expired = moment.tz('Asia/Jakarta').add(2, 'hours').format('YYYYMMDDHHmmss');

            // Normalisasi Nomor HP
            let phone = (customer.phone || '081234567890').replace(/[^0-9]/g, '');
            if (phone.startsWith('0')) phone = '62' + phone.substring(1);

            const linkquData = {
                amount: Math.round(Number(amount)),
                expired,
                partner_reff,
                // PENTING: Gunakan bank_code jika ada, jika tidak gunakan method.
                // Helper LinkQuUtility akan mencari key ini di bankMapping.
                bank_code: bank_code || method,
                method: method,
                customer_id: String(customer.id || phone),
                customer_name: (customer.name || 'Customer').substring(0, 30),
                customer_email: customer.email || 'guest@mail.com',
                customer_phone: phone,
                url_callback: "https://api.siappgo.id/api/payments/callback"
            };

            console.log(`[Payment] 🚀 Mengirim Request ke LinkQu dengan input bank: ${linkquData.bank_code}`);

            let result;
            // Cek apakah metode pembayaran adalah Virtual Account
            if (method.toUpperCase().includes('VA')) {
                result = await LinkQu.createVA(linkquData);
            } else {
                result = await LinkQu.createQRIS(linkquData);
            }

            // --- VALIDASI RESPONSE LINKQU ---
            // Sesuaikan dengan response_code LinkQu (biasanya '200' untuk sukses)
            const isSuccess = result?.response_code === '200' || result?.status === 'SUCCESS';

            if (!isSuccess) {
                const errorDesc = result?.response_desc || result?.message || "Koneksi LinkQu Gagal";
                console.error(`[Payment] ❌ LinkQu Rejected: ${errorDesc}`);
                throw new Error(`LinkQu: ${errorDesc}`);
            }

            // Ekstraksi data secara fleksibel
            const vaNumber = result.data?.va_number || result.virtual_account || result.va_number || null;
            const qrisUrl = result.data?.qr_url || result.imageqris || result.qr_url || null;

            const mysqlExpired = moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss');

            console.log(`[Payment] ✅ LinkQu OK! Menyimpan ke Database...`);

            // Simpan bank_code final yang digunakan (hasil mapping dari helper atau default)
            // Jika ingin menyimpan kode angka (009), pastikan result mengembalikannya.
            await client.query(
                `INSERT INTO payments (
                    order_id, partner_reff, method, bank_code, 
                    va_number, qris_url, amount, status, 
                    expired_at, payload_request
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
                [
                    order_id, partner_reff, method, bank_code || method,
                    vaNumber, qrisUrl, linkquData.amount,
                    mysqlExpired, JSON.stringify(result)
                ]
            );

            return { vaNumber, qrisUrl, partner_reff };

        } catch (error) {
            console.error("[Payment] ❌ Exception Details:", error.message);
            throw error;
        }
    }
};

module.exports = PaymentController;