const LinkQu = require('../utils/linkqu');
const moment = require('moment-timezone');
const db = require('../config/db');

const PaymentController = {
    requestPaymentGateway: async (payload, tx = null) => {
        const { order_id, order_code, amount, customer, method, bank_code } = payload;
        const client = tx || db;

        console.log(`[Frontend-In] 📥 Method: ${method}, BankCode Raw: ${bank_code}, Order: ${order_code}`);

        try {
            // --- MAPPING BANK LANGSUNG DI SINI ---
            const bankMapping = {
                'va_bni': '009', 'bni': '009', 'BNI': '009',
                'va_bri': '002', 'bri': '002', 'BRI': '002',
                'va_mandiri': '008', 'mandiri': '008', 'MANDIRI': '008',
                'va_bca': '014', 'bca': '014', 'BCA': '014',
                'va_permata': '013', 'permata': '013', 'PERMATA': '013'
            };

            // Ambil identifier bank dari bank_code (va_bni) atau method
            const rawBank = (bank_code || method || '').toLowerCase();
            const finalBankCode = bankMapping[rawBank] || '002'; // Default ke BRI jika tidak ketemu

            console.log(`[Payment] 🛠️ Mapping Result: ${rawBank} -> ${finalBankCode}`);

            const partner_reff = `PAY-ORD-${order_code}`;
            const expired = moment.tz('Asia/Jakarta').add(2, 'hours').format('YYYYMMDDHHmmss');

            let phone = (customer.phone || '081234567890').replace(/[^0-9]/g, '');
            if (phone.startsWith('0')) phone = '62' + phone.substring(1);

            const linkquData = {
                amount: Math.round(Number(amount)),
                expired,
                partner_reff,
                bank_code: finalBankCode, // SEKARANG SUDAH JADI "009"
                method: method,
                customer_id: String(customer.id || phone),
                customer_name: (customer.name || 'Customer').substring(0, 30),
                customer_email: customer.email || 'guest@mail.com',
                customer_phone: phone,
                url_callback: "https://api.siappgo.id/api/payments/callback"
            };

            console.log(`[Payment] 🚀 Request LinkQu dengan Bank: ${linkquData.bank_code}`);

            let result;
            if (method.toUpperCase().includes('VA')) {
                result = await LinkQu.createVA(linkquData);
            } else {
                result = await LinkQu.createQRIS(linkquData);
            }

            const isSuccess = result?.response_code === '200' || result?.status === 'SUCCESS';

            if (!isSuccess) {
                const errorDesc = result?.response_desc || result?.message || "Koneksi LinkQu Gagal";
                console.error(`[Payment] ❌ LinkQu Rejected: ${errorDesc}`);
                throw new Error(`LinkQu: ${errorDesc}`);
            }

            const vaNumber = result.data?.va_number || result.virtual_account || result.va_number || null;
            const qrisUrl = result.data?.qr_url || result.imageqris || result.qr_url || null;

            const mysqlExpired = moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss');

            console.log(`[Payment] ✅ LinkQu OK! Menyimpan ke Database...`);

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
            console.error("[Payment] ❌ Exception Details:", error.message);
            throw error;
        }
    }
};

module.exports = PaymentController;