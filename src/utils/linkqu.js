const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const config = {
    clientId: "testing", // Ganti dengan process.env.LINKQU_CLIENT_ID
    clientSecret: "123", // Ganti dengan process.env.LINKQU_CLIENT_SECRET
    username: "LI307GXIN",
    pin: "2K2NPCBBNNTovgB",
    baseUrl: 'https://gateway-dev.linkqu.id/linkqu-partner'
};

const logToFile = (title, message) => {
    try {
        const logDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, 'linkqu.log');
        const timestamp = new Date().toLocaleString('id-ID');
        const logMessage = `[${timestamp}] === ${title} ===\n${JSON.stringify(message, null, 2)}\n------------------------------------------\n`;
        fs.appendFileSync(logPath, logMessage);
    } catch (err) { console.error("❌ Log Error:", err); }
};

/**
 * Signature berdasarkan JSON string sesuai referensi terbaru Anda
 */
const generateSignature = (data) => {
    const payload = JSON.stringify(data);
    return crypto
        .createHmac('sha256', config.clientSecret)
        .update(payload)
        .digest('hex');
};

const LinkQu = {
    hitAPI: async (endpoint, data) => {
        const signature = generateSignature(data);
        const fullPayload = {
            ...data,
            username: config.username,
            pin: config.pin,
            signature
        };

        try {
            logToFile(`REQUEST ${endpoint}`, fullPayload);
            const response = await axios.post(`${config.baseUrl}${endpoint}`, fullPayload, {
                headers: {
                    'client-id': config.clientId,
                    'client-secret': config.clientSecret,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });
            logToFile(`RESPONSE ${endpoint}`, response.data);
            return response.data;
        } catch (error) {
            const errData = error.response?.data || error.message;
            logToFile(`ERROR ${endpoint}`, errData);
            return errData;
        }
    },

    createVA: async (d) => {
        // Mapping Bank Code untuk VA
        const bankMap = { 'va_bni': '009', 'va_bri': '002', 'va_bca': '014', 'va_mandiri': '008', 'va_permata': '013' };
        const bank_code = bankMap[d.method?.toLowerCase()] || d.bank_code;

        if (!bank_code) throw new Error(`Bank Code not found for method: ${d.method}`);

        const payload = {
            amount: String(d.amount),
            expired: d.expired,
            bank_code: bank_code,
            partner_reff: d.partner_reff,
            customer_id: d.customer_id,
            customer_name: d.customer_name,
            customer_email: d.customer_email,
            customer_phone: d.customer_phone,
            remark: d.remark || "Payment VA",
            url_callback: d.url_callback
        };
        return await LinkQu.hitAPI('/transaction/create/va', payload);
    },

    createQRIS: async (d) => {
        const payload = {
            amount: String(d.amount),
            expired: d.expired,
            partner_reff: d.partner_reff,
            customer_id: d.customer_id,
            customer_name: d.customer_name,
            customer_email: d.customer_email,
            customer_phone: d.customer_phone,
            url_callback: d.url_callback
        };
        return await LinkQu.hitAPI('/transaction/create/qris', payload);
    }
};

module.exports = LinkQu;