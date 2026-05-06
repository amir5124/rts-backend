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

            console.log(`[Payment] 🚀 Requesting ${method} for Reff: ${partner_reff}`);
            
            let result;
            if (method.toUpperCase().includes('VA')) {
                result = await LinkQu.createVA(linkquData);
            } else {
                result = await LinkQu.createQRIS(linkquData);
            }

            // Validasi Response
            if (!result || result.response_code !== '200') {
                const errorDesc = result?.response_desc || "No Response from LinkQu";
                console.error(`[Payment] ❌ LinkQu Rejected: ${errorDesc}`);
                throw new Error(`LinkQu: ${errorDesc}`);
            }

            const vaNumber = result.virtual_account || result.va_number || result.data?.va_number || null;
            const qrisUrl = result.imageqris || result.qr_url || result.data?.qr_url || null;

            const mysqlExpired = moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss');
            
            console.log(`[Payment] ✅ Success! Saving to DB. VA: ${vaNumber}`);

            await client.query(
                `INSERT INTO payments (
                    order_id, partner_reff, method, bank_code, 
                    va_number, qris_url, amount, status, 
                    expired_at, payload_request
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
                [
                    order_id, partner_reff, method, bank_code, 
                    vaNumber, qrisUrl, linkquData.amount, 
                    mysqlExpired, JSON.stringify(result)
                ]
            );

            return { vaNumber, qrisUrl, partner_reff };

        } catch (error) {
            console.error("[Payment] ❌ Exception:", error.message);
            throw error; 
        }
    }
};

module.exports = PaymentController;