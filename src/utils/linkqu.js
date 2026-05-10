const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const config = {
    clientId: "testing",
    clientSecret: "123",
    username: "LI307GXIN",
    pin: "2K2NPCBBNNTovgB",
    serverKey: "LinkQu@2020",
    baseUrl: 'https://gateway-dev.linkqu.id/linkqu-partner'
};

/**
 * Log otomatis ke file logs/linkqu.log dengan format yang lebih rapi
 */
const logToFile = (title, message) => {
    try {
        const logDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

        const logPath = path.join(logDir, 'linkqu.log');
        const timestamp = new Date().toLocaleString('id-ID');
        const content = typeof message === 'object' ? JSON.stringify(message, null, 2) : message;
        const logMessage = `[${timestamp}] === ${title} ===\n${content}\n------------------------------------------\n`;

        fs.appendFileSync(logPath, logMessage);
    } catch (err) {
        console.error("❌ Log Error:", err);
    }
};

/**
 * Signature Generator
 * Mencatat 'String to Sign' ke log untuk mempermudah debugging signature.
 */
const generateSignature = (endpoint, method, data) => {
    const rawValue = Object.values(data).join('') + config.clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
    const stringToSign = endpoint + method + cleaned;

    const signature = crypto
        .createHmac('sha256', config.serverKey)
        .update(stringToSign)
        .digest('hex');

    // Debugging Signature (Sangat penting saat integrasi awal)
    logToFile(`DEBUG SIGNATURE - ${endpoint}`, {
        input_data: data,
        string_to_sign: stringToSign,
        result_signature: signature
    });

    return signature;
};

const LinkQuUtility = {

    hitLinkQu: async (endpoint, payload) => {
        try {
            logToFile(`REQUEST ${endpoint}`, payload);

            const response = await axios.post(`${config.baseUrl}${endpoint}`, payload, {
                headers: {
                    'client-id': config.clientId,
                    'client-secret': config.clientSecret,
                    'Content-Type': 'application/json'
                },
                timeout: 25000 // Menambah timeout sedikit lebih lama
            });

            logToFile(`RESPONSE SUCCESS ${endpoint}`, response.data);
            return response.data;

        } catch (error) {
            const errorDetail = {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            };
            logToFile(`ERROR ${endpoint}`, errorDetail);
            console.error(`[LinkQu] ❌ HTTP Error ${endpoint}:`, errorDetail);

            // Kembalikan objek error agar controller bisa memberikan feedback ke frontend
            return {
                success: false,
                message: error.response?.data?.message || error.message || 'LinkQu Server Error'
            };
        }
    },

    createVA: async (d) => {
        const bankMapping = {
            'va_bri': '002', 'bri': '002',
            'va_mandiri': '008', 'mandiri': '008',
            'va_bni': '009', 'bni': '009',
            'va_permata': '013', 'permata': '013',
            'va_bca': '014', 'bca': '014',
        };

        const endpoint = '/transaction/create/va';
        const method = 'POST';

        // Validasi dan Normalisasi Bank Code
        const methodKey = String(d.method || '').toLowerCase();
        const bank_code = bankMapping[methodKey] || d.bank_code;

        if (!bank_code) {
            logToFile("VALIDATION ERROR", `Bank Not Supported: ${methodKey}`);
            return { success: false, message: `LinkQu: Bank '${methodKey}' tidak didukung.` };
        }

        // Pastikan semua data adalah STRING sesuai spek API
        const amount = String(Math.round(Number(d.amount)));
        const expired = String(d.expired || 60);
        const partner_reff = String(d.partner_reff);
        const customer_id = String(d.customer_id);
        const customer_name = String(d.customer_name || 'Customer').substring(0, 30).trim();
        const customer_email = String(d.customer_email || 'customer@mail.com').trim();

        let customer_phone = String(d.customer_phone || '').replace(/[^0-9]/g, '');
        if (customer_phone.startsWith('0')) customer_phone = '62' + customer_phone.substring(1);
        if (!customer_phone) customer_phone = '628123456789';

        const signatureData = {
            amount,
            expired,
            bank_code,
            partner_reff,
            customer_id,
            customer_name,
            customer_email
        };

        const signature = generateSignature(endpoint, method, signatureData);

        const finalBody = {
            ...signatureData,
            customer_phone,
            remark: d.remark || 'Payment ' + partner_reff,
            url_callback: d.url_callback || 'https://api.siappgo.id/api/payments/callback',
            username: config.username,
            pin: config.pin,
            signature
        };

        return await LinkQuUtility.hitLinkQu(endpoint, finalBody);
    },

    createQRIS: async (d) => {
        const endpoint = '/transaction/create/qris';
        const method = 'POST';

        const amount = String(Math.round(Number(d.amount)));
        const expired = String(d.expired || 60);
        const partner_reff = String(d.partner_reff);
        const customer_id = String(d.customer_id);
        const customer_name = String(d.customer_name || 'Customer').substring(0, 30).trim();
        const customer_email = String(d.customer_email || 'customer@mail.com').trim();

        let customer_phone = String(d.customer_phone || '').replace(/[^0-9]/g, '');
        if (customer_phone.startsWith('0')) customer_phone = '62' + customer_phone.substring(1);

        const signatureData = {
            amount,
            expired,
            partner_reff,
            customer_id,
            customer_name,
            customer_email
        };

        const signature = generateSignature(endpoint, method, signatureData);

        const finalBody = {
            ...signatureData,
            customer_phone: customer_phone || '628123456789',
            url_callback: d.url_callback || 'https://api.siappgo.id/api/payments/callback',
            username: config.username,
            pin: config.pin,
            signature
        };

        return await LinkQuUtility.hitLinkQu(endpoint, finalBody);
    }
};

module.exports = LinkQuUtility;