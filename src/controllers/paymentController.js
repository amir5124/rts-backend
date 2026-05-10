const LinkQu = require('../utils/linkqu');
const moment = require('moment-timezone');
const db = require('../config/db');

const PaymentController = {
    requestPaymentGateway: async (payload, tx = null) => {
        const { order_id, order_code, amount, customer, method } = payload;
        const client = tx || db;

        try {
            const partner_reff = `PAY-ORD-${order_code}`;
            // Expired 2 jam ke depan sesuai format LinkQu
            const expired = moment.tz('Asia/Jakarta').add(2, 'hours').format('YYYYMMDDHHmmss');

            // Bersihkan nomor telepon (LinkQu minta diawali 62 atau format bersih)
            let phone = (customer.phone || '08123456789').replace(/[^0-9]/g, '');
            if (phone.startsWith('0')) phone = '62' + phone.substring(1);

            const linkquData = {
                amount: Math.round(Number(amount)),
                expired,
                partner_reff,
                method: method, // misal: 'va_bni'
                customer_id: String(customer.id || 'CUST-' + Date.now()),
                customer_name: (customer.name || 'Customer').substring(0, 30),
                customer_email: customer.email || 'guest@mail.com',
                customer_phone: phone,
                url_callback: "https://api.siappgo.id/api/payments/callback"
            };

            console.log(`[Payment] 🚀 Mengirim ke LinkQu: ${method} | Reff: ${partner_reff}`);

            let result;
            if (method.toLowerCase().includes('va')) {
                result = await LinkQu.createVA(linkquData);
            } else {
                result = await LinkQu.createQRIS(linkquData);
            }

            // LinkQu Response Status biasanya 'SUCCESS' atau '200' tergantung endpoint
            const status = result?.status || result?.response_code;
            if (status !== 'SUCCESS' && status !== '200') {
                const msg = result?.message || result?.response_desc || "Unknown Error";
                throw new Error(`LinkQu Rejected: ${msg}`);
            }

            // Ambil data VA/QRIS (LinkQu sering ganti-ganti letak property)
            const vaNumber = result.data?.va_number || result.virtual_account || result.va_number || null;
            const qrisUrl = result.data?.qr_url || result.imageqris || result.qr_url || null;

            const mysqlExpired = moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss');

            await client.query(
                `INSERT INTO payments (
                    order_id, partner_reff, method, 
                    va_number, qris_url, amount, status, 
                    expired_at, payload_request
                ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
                [
                    order_id, partner_reff, method,
                    vaNumber, qrisUrl, linkquData.amount,
                    mysqlExpired, JSON.stringify(result)
                ]
            );

            return { vaNumber, qrisUrl, partner_reff };

        } catch (error) {
            console.error("[Payment] ❌ Exception:", error.message);
            throw error; // Re-throw agar ditangkap oleh rollback DB di level atas
        }
    }
};

module.exports = PaymentController;