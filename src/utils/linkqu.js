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
 * Helper untuk membersihkan string agar aman masuk ke signature
 */
const clean = (str) => {
    if (!str) return "";
    return String(str).replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
};

/**
 * Fungsi internal dengan Logging Lengkap
 */
const hitLinkQu = async (endpoint, data, rawSig) => {
    try {
        const cleanSig = clean(rawSig);
        const signature = crypto.createHmac("sha256", config.serverKey)
            .update(endpoint + 'POST' + cleanSig)
            .digest("hex");

        console.log(`--- 🛡️  LINKQU SECURITY DEBUG ---`);
        console.log(`📍 Endpoint  : ${endpoint}`);
        console.log(`📝 Raw Sig   : ${rawSig}`);
        console.log(`🧹 Clean Sig : ${cleanSig}`);
        console.log(`🔑 Final Sig : ${signature}`);
        console.log(`---------------------------------`);

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
            timeout: 10000 // Timeout 10 detik agar tidak hang
        });

        return response.data;
    } catch (error) {
        console.error("❌ LinkQu API Error:");
        if (error.response) {
            console.error("Data   :", JSON.stringify(error.response.data, null, 2));
            console.error("Status :", error.response.status);
        } else {
            console.error("Message:", error.message);
        }
        throw error;
    }
};

module.exports = {
    createVA: async (d) => {
        try {
            const bankMapping = {
                'VA BRI': '002', 'BRI': '002',
                'VA MANDIRI': '008', 'MANDIRI': '008',
                'VA BNI': '009', 'BNI': '009',
                'VA PERMATA': '013', 'PERMATA': '013',
                'VA BCA': '014', 'BCA': '014'
            };

            const selectedBankCode = bankMapping[d.method?.toUpperCase()] || d.bank_code || '002';

            // Sanitize data: Pastikan tidak ada undefined yang masuk ke string signature
            const payload = {
                amount: String(Math.round(Number(d.amount))), // Harus integer string
                partner_reff: String(d.partner_reff || ""),
                customer_id: String(d.customer_id || "CUST-001"),
                customer_name: (d.customer_name || "Customer").trim(),
                expired: String(d.expired || ""),
                customer_phone: String(d.customer_phone || "081234567890"),
                customer_email: (d.customer_email || "guest@mail.com").trim(),
                bank_code: String(selectedBankCode),
                remark: "Pembayaran Order " + (d.partner_reff || ""),
                url_callback: d.url_callback || "https://api.siappgo.id/api/payments/callback"
            };

            // Urutan WAJIB LinkQu: amount + expired + bank_code + partner_reff + nama + nama + email + client_id
            const rawSig = 
                payload.amount + 
                payload.expired + 
                payload.bank_code + 
                payload.partner_reff + 
                payload.customer_name + 
                payload.customer_name + 
                payload.customer_email + 
                config.clientId;

            return await hitLinkQu('/transaction/create/va', payload, rawSig);
        } catch (err) {
            throw new Error(`CreateVA failed: ${err.message}`);
        }
    },

    createQRIS: async (d) => {
        try {
            const payload = {
                amount: String(Math.round(Number(d.amount))),
                partner_reff: String(d.partner_reff || ""),
                customer_id: String(d.customer_id || "CUST-001"),
                customer_name: (d.customer_name || "Customer").trim(),
                customer_phone: String(d.customer_phone || "081234567890"),
                customer_email: (d.customer_email || "guest@mail.com").trim(),
                expired: String(d.expired || ""),
                url_callback: d.url_callback || "https://api.siappgo.id/api/payments/callback"
            };

            // Urutan QRIS: amount + expired + partner_reff + nama + nama + email + client_id
            const rawSig = 
                payload.amount + 
                payload.expired + 
                payload.partner_reff + 
                payload.customer_name + 
                payload.customer_name + 
                payload.customer_email + 
                config.clientId;

            return await hitLinkQu('/transaction/create/qris', payload, rawSig);
        } catch (err) {
            throw new Error(`CreateQRIS failed: ${err.message}`);
        }
    },

     checkStatus: async (partnerReff) => {
        try {
            const response = await axios.get(`${config.baseUrl}/transaction/payment/checkstatus`, {
                params: {
                    username: config.username,
                    partnerreff: partnerReff
                },
                headers: {
                    'client-id': config.clientId,
                    'client-secret': config.clientSecret
                }
            });
            return response.data;
        } catch (error) {
            console.error("LinkQu Check Status Error:", error.response?.data || error.message);
            throw error;
        }
    }
};