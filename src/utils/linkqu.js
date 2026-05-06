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
 * Log otomatis ke file logs/linkqu.log
 */
const logToFile = (title, message) => {
    try {
        const logDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        
        const logPath = path.join(logDir, 'linkqu.log');
        const timestamp = new Date().toLocaleString('id-ID');
        const logMessage = `[${timestamp}] === ${title} ===\n${typeof message === 'object' ? JSON.stringify(message, null, 2) : message}\n------------------------------------------\n`;
        
        fs.appendFileSync(logPath, logMessage);
    } catch (err) {
        console.error("❌ Log Error:", err);
    }
};

/**
 * Pembuatan Signature sesuai kode referensi (HMAC SHA256 dari JSON Body)
 */
const generateSignature = (data) => {
    const payload = JSON.stringify(data);
    return crypto
        .createHmac('sha256', config.clientSecret)
        .update(payload)
        .digest('hex');
};

const LinkQuUtility = {
    hitLinkQu: async (endpoint, payload) => {
        try {
            // Tambahkan username & pin ke payload utama sebelum di-hash
            const fullBody = {
                ...payload,
                username: config.username,
                pin: config.pin
            };

            // Generate signature dari body JSON utuh
            const signature = generateSignature(fullBody);
            
            // Sertakan signature ke dalam body
            const finalBody = { ...fullBody, signature };

            logToFile(`REQUEST ${endpoint}`, finalBody);

            const response = await axios.post(`${config.baseUrl}${endpoint}`, finalBody, {
                headers: {
                    'client-id': config.clientId,
                    'client-secret': config.clientSecret,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            });

            logToFile(`RESPONSE ${endpoint}`, response.data);
            return response.data;
        } catch (error) {
            const errorData = error.response?.data || error.message;
            logToFile(`ERROR ${endpoint}`, errorData);
            console.error(`[LinkQu] ❌ Error ${endpoint}:`, errorData);
            throw error;
        }
    },

    createVA: async (d) => {
        const bankMapping = {
            'VA BRI': '002', 'BRI': '002', 'VA_BRI': '002',
            'VA MANDIRI': '008', 'MANDIRI': '008',
            'VA BNI': '009', 'BNI': '009',
            'VA PERMATA': '013', 'PERMATA': '013',
            'VA BCA': '014', 'BCA': '014'
        };

        const payload = {
            amount: String(d.amount),
            expired: String(d.expired),
            bank_code: String(bankMapping[d.method?.toUpperCase()] || d.bank_code || '002'),
            partner_reff: String(d.partner_reff),
            customer_id: String(d.customer_id || "CUST-001"),
            customer_name: String(d.customer_name || "Customer").trim(),
            customer_email: String(d.customer_email || "guest@mail.com").trim(),
            customer_phone: String(d.customer_phone || "081234567890").replace(/[^0-9]/g, ""),
            remark: "Payment " + d.partner_reff,
            url_callback: d.url_callback || "https://api.siappgo.id/api/payments/callback"
        };

        return await LinkQuUtility.hitLinkQu('/transaction/create/va', payload);
    },

    createQRIS: async (d) => {
        const payload = {
            amount: String(d.amount),
            expired: String(d.expired),
            partner_reff: String(d.partner_reff),
            customer_id: String(d.customer_id || "CUST-001"),
            customer_name: String(d.customer_name || "Customer").trim(),
            customer_phone: String(d.customer_phone || "081234567890").replace(/[^0-9]/g, ""),
            customer_email: String(d.customer_email || "guest@mail.com").trim(),
            url_callback: d.url_callback || "https://api.siappgo.id/api/payments/callback"
        };

        return await LinkQuUtility.hitLinkQu('/transaction/create/qris', payload);
    }
};

module.exports = LinkQuUtility;