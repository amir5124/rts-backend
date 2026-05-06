const axios = require('axios');
const crypto = require('crypto');

// Gunakan environment variables atau config object
const config = {
    clientId: "testing",
    clientSecret: "123",
    username: "LI307GXIN",
    pin: "2K2NPCBBNNTovgB",
    serverKey: "LinkQu@2020",
    baseUrl: 'https://gateway-dev.linkqu.id/linkqu-partner'
};
/**
 * Fungsi internal untuk memukul API LinkQu dengan Signature HmacSha256
 */
const hitLinkQu = async (endpoint, data, rawSig) => {
    // Generate Signature: endpoint + POST + rawSig (clean alphanumeric lowercase)
    const signature = crypto.createHmac("sha256", config.serverKey)
        .update(endpoint + 'POST' + rawSig.replace(/[^0-9a-zA-Z]/g, "").toLowerCase())
        .digest("hex");

    return await axios.post(`${config.baseUrl}${endpoint}`, {
        ...data,
        username: config.username,
        pin: config.pin,
        signature
    }, {
        headers: {
            'client-id': config.clientId,
            'client-secret': config.clientSecret,
            'Content-Type': 'application/json'
        }
    });
};

module.exports = {
    /**
     * Membuat Virtual Account
     */
    createVA: async (d) => {
        const bankMapping = {
            'VA BRI': '002',
            'BRI': '002',
            'VA MANDIRI': '008',
            'MANDIRI': '008',
            'VA BNI': '009',
            'BNI': '009',
            'VA PERMATA': '013',
            'PERMATA': '013',
            'VA BCA': '014',
            'BCA': '014'
        };

        const selectedBankCode = bankMapping[d.method?.toUpperCase()] || d.bank_code;

        const payload = {
            amount: d.amount,
            partner_reff: d.partner_reff,
            customer_id: String(d.customer_id || "CUST-001"),
            customer_name: d.customer_name.trim(),
            expired: d.expired,
            customer_phone: d.customer_phone || "081234567890",
            customer_email: d.customer_email,
            bank_code: selectedBankCode,
            remark: "Pembayaran Order " + d.partner_reff,
            url_callback: d.url_callback || "https://api.siappgo.id/api/payments/callback"
        };

        // Urutan rawSig VA sesuai dokumentasi: amount + expired + bank_code + partner_reff + nama + nama + email + client_id
        const rawSig = payload.amount + payload.expired + payload.bank_code + payload.partner_reff + 
                       payload.customer_name + payload.customer_name + payload.customer_email + config.clientId;

        return await hitLinkQu('/transaction/create/va', payload, rawSig);
    },

    /**
     * Membuat QRIS
     */
    createQRIS: async (d) => {
        const payload = {
            amount: d.amount,
            partner_reff: d.partner_reff,
            customer_id: String(d.customer_id || "CUST-001"),
            customer_name: d.customer_name.trim(),
            customer_phone: d.customer_phone || "081234567890",
            customer_email: d.customer_email,
            expired: d.expired,
            url_callback: d.url_callback || "https://api.siappgo.id/api/payments/callback"
        };

        // Urutan rawSig QRIS: amount + expired + partner_reff + nama + nama + email + client_id
        const rawSig = payload.amount + payload.expired + payload.partner_reff + 
                       payload.customer_name + payload.customer_name + payload.customer_email + config.clientId;

        return await hitLinkQu('/transaction/create/qris', payload, rawSig);
    },

    /**
     * Cek Status (Polling)
     */
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