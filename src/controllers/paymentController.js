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
            
            const linkquData = {
                amount: Math.round(Number(amount)),
                expired,
                partner_reff,
                bank_code,
                method,
                customer_id: customer.phone ? customer.phone.replace(/[^0-9]/g, '') : 'CUST-001',
                customer_name: (customer.name || 'Customer').substring(0, 30),
                customer_email: customer.email || 'guest@mail.com',
                customer_phone: customer.phone || '081234567890',
                url_callback: "https://api.siappgo.id/api/payments/callback"
            };

            console.log("API: Meminta session ke LinkQu...");
            
            // Panggil Utility LinkQu
            let result;
            if (method.toUpperCase().includes('VA')) {
                result = await LinkQu.createVA(linkquData);
            } else {
                result = await LinkQu.createQRIS(linkquData);
            }

            // --- PROTEKSI DISINI ---
            // Cek apakah result ada, jika tidak ada (undefined), lempar error manual
            if (!result) {
                throw new Error("LinkQu return empty response");
            }

            // Cek status response dari LinkQu
            if (result.status === 'FAILED' || result.response_code !== '200') {
                const errorMsg = result.response_desc || "Unknown Error from LinkQu";
                throw new Error(`LinkQu: ${errorMsg}`);
            }

            // Parsing data pembayaran berdasarkan jenis (VA atau QRIS)
            const vaNumber = result.virtual_account || result.va_number || (result.data ? result.data.va_number : null);
            const qrisUrl = result.imageqris || result.qr_url || (result.data ? result.data.qr_url : null);

            // Simpan ke tabel payments (sesuai struktur DESCRIBE payments kamu)
            const mysqlExpired = moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss');
            
            await client.query(
                `INSERT INTO payments (
                    order_id, partner_reff, method, bank_code, 
                    va_number, qris_url, amount, status, 
                    expired_at, payload_request
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
                [
                    order_id, 
                    partner_reff, 
                    method, 
                    bank_code, 
                    vaNumber, 
                    qrisUrl, 
                    linkquData.amount, 
                    mysqlExpired,
                    JSON.stringify(linkquData)
                ]
            );

            return { vaNumber, qrisUrl, partner_reff };

        } catch (error) {
            console.error("❌ Payment Gateway Error:", error.message);
            // Melempar error agar transaksi di OrderController melakukan ROLLBACK
            throw error; 
        }
    }
};

module.exports = PaymentController;