const axios = require('axios');
const crypto = require('crypto');

const config = {
    clientId: process.env.LINKQU_CLIENT_ID || "testing",
    clientSecret: process.env.LINKQU_CLIENT_SECRET || "123",
    username: process.env.LINKQU_USERNAME || "LI307GXIN",
    pin: process.env.LINKQU_PIN || "2K2NPCBBNNTovgB",
    serverKey: process.env.LINKQU_SERVER_KEY || "LinkQu@2020",
    baseUrl: process.env.LINKQU_BASE_URL || 'https://gateway-dev.linkqu.id/linkqu-partner'
};

/**
 * Helper untuk membersihkan string signature agar hanya berisi alfanumerik lowercase
 */
const cleanForSig = (str) => String(str || "").replace(/[^0-9a-zA-Z]/g, "").toLowerCase();

const LinkQuUtility = {
    hitLinkQu: async (endpoint, data, rawSig) => {
        try {
            const cleanSig = cleanForSig(rawSig);
            const signature = crypto.createHmac("sha256", config.serverKey)
                .update(endpoint + 'POST' + cleanSig)
                .digest("hex");

            console.log(`[LinkQu] 🔒 SIG DEBUG | Endpoint: ${endpoint} | Raw: ${rawSig} | Final: ${signature}`);

            const response = await axios.post(`${config.baseUrl}${endpoint}`, {
                ...data,
                username: config.username,
                pin: config.pin,
                signature
            }, {
                headers: {
                    'client-id': config.clientId,
                    'client-secret': config.clientSecret,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            return response.data;
        } catch (error) {
            console.error("[LinkQu] ❌ HTTP Error:", error.response?.data || error.message);
            throw error;
        }
    },

    createVA: async (d) => {
        const bankMapping = {
            'VA BRI': '002', 'BRI': '002',
            'VA MANDIRI': '008', 'MANDIRI': '008',
            'VA BNI': '009', 'BNI': '009',
            'VA PERMATA': '013', 'PERMATA': '013',
            'VA BCA': '014', 'BCA': '014'
        };

        const bank_code = bankMapping[d.method?.toUpperCase()] || d.bank_code || '002';
        const payload = {
            amount: String(d.amount),
            expired: String(d.expired),
            bank_code: String(bank_code),
            partner_reff: String(d.partner_reff),
            customer_id: String(d.customer_id || "CUST-001"),
            customer_name: String(d.customer_name || "Customer").trim(),
            customer_email: String(d.customer_email || "guest@mail.com").trim(),
            customer_phone: String(d.customer_phone || "081234567890"),
            remark: "Pembayaran Order " + d.partner_reff,
            url_callback: d.url_callback
        };

        const rawSig = payload.amount + payload.expired + payload.bank_code + payload.partner_reff + 
                       payload.customer_name + payload.customer_name + payload.customer_email + config.clientId;

        return await LinkQuUtility.hitLinkQu('/transaction/create/va', payload, rawSig);
    },

    createQRIS: async (d) => {
        const payload = {
            amount: String(d.amount),
            expired: String(d.expired),
            partner_reff: String(d.partner_reff),
            customer_id: String(d.customer_id || "CUST-001"),
            customer_name: String(d.customer_name || "Customer").trim(),
            customer_phone: String(d.customer_phone || "081234567890"),
            customer_email: String(d.customer_email || "guest@mail.com").trim(),
            url_callback: d.url_callback
        };

        const rawSig = payload.amount + payload.expired + payload.partner_reff + 
                       payload.customer_name + payload.customer_name + payload.customer_email + config.clientId;

        return await LinkQuUtility.hitLinkQu('/transaction/create/qris', payload, rawSig);
    }
};

module.exports = LinkQuUtility;