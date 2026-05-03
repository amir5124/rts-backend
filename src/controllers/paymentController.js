const axios = require('axios');
const crypto = require('crypto');
const moment = require('moment-timezone');
const db = require('../config/db');

// Gunakan config testing sesuai permintaan Anda
const config = {
    clientId: "testing",
    clientSecret: "123",
    username: "LI307GXIN",
    pin: "2K2NPCBBNNTovgB",
    serverKey: "LinkQu@2020",
    baseUrl: 'https://gateway-dev.linkqu.id/linkqu-partner'
};

function generateSignature(path, method, data) {
    const rawValue = Object.values(data).join('') + config.clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    return crypto.createHmac("sha256", config.serverKey)
        .update(path + method + cleaned)
        .digest("hex");
}

const PaymentController = {
    // Fungsi Internal untuk dipanggil oleh OrderController
    requestPaymentGateway: async (payload) => {
        const { order_id, order_code, amount, customer, method, bank_code } = payload;
        
        const partner_reff = `PAY-ORD-${order_code}`;
        const expired = moment.tz('Asia/Jakarta').add(2, 'hours').format('YYYYMMDDHHmmss');
        const url_callback = "https://api.siappgo.id/api/payments/callback"; // Sesuaikan domain

        const commonData = {
            amount: Math.round(amount),
            expired,
            partner_reff,
            customer_id: customer.phone,
            customer_name: customer.name.substring(0, 30),
            customer_email: customer.email
        };

        let endpoint = method === 'VA' ? '/transaction/create/va' : '/transaction/create/qris';
        let payloadLinkQu = { ...commonData, username: config.username, pin: config.pin, url_callback };

        if (method === 'VA') {
            payloadLinkQu.bank_code = bank_code;
            payloadLinkQu.signature = generateSignature(endpoint, 'POST', { ...commonData, bank_code });
        } else {
            payloadLinkQu.signature = generateSignature(endpoint, 'POST', commonData);
        }

        const resp = await axios.post(`${config.baseUrl}${endpoint}`, payloadLinkQu, {
            headers: { 'client-id': config.clientId, 'client-secret': config.clientSecret }
        });

        const linkquData = resp.data;
        const vaNumber = linkquData.virtual_account || linkquData.va_number || (linkquData.data?.va_number);
        const qrisUrl = linkquData.imageqris || linkquData.qr_url || (linkquData.data?.qr_url);

        // Simpan ke tabel payments
        await db.query(
            `INSERT INTO payments (order_id, partner_reff, method, bank_code, va_number, qris_url, amount, status, expired_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
            [order_id, partner_reff, method, bank_code, vaNumber, qrisUrl, amount, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]
        );

        return { vaNumber, qrisUrl, partner_reff };
    },

    handleCallback: async (req, res) => {
        const { partner_reff, status } = req.body;
        if (status?.toUpperCase() === "SUCCESS" || status?.toUpperCase() === "SETTLED") {
            const [rows] = await db.query("SELECT order_id FROM payments WHERE partner_reff = ?", [partner_reff]);
            if (rows.length > 0) {
                const orderId = rows[0].order_id;
                await db.query("UPDATE payments SET status = 'SUCCESS', paid_at = NOW() WHERE partner_reff = ?", [partner_reff]);
                // Update tabel orders ke status 'paid'
                await db.query("UPDATE orders SET status = 'paid' WHERE id = ?", [orderId]);
            }
        }
        return res.json({ message: "OK" });
    }
};

module.exports = PaymentController;