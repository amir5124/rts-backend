const axios = require('axios');
const crypto = require('crypto');

// Konfigurasi LinkQu (Disarankan menggunakan process.env)
const config = {
    clientId: process.env.LINKQU_CLIENT_ID || "testing",
    clientSecret: process.env.LINKQU_CLIENT_SECRET || "123",
    username: process.env.LINKQU_USERNAME || "LI307GXIN",
    pin: process.env.LINKQU_PIN || "2K2NPCBBNNTovgB",
    baseUrl: 'https://gateway-dev.linkqu.id/linkqu-partner'
};

/**
 * Generate Signature LinkQu berdasarkan JSON payload
 */
const generateSignature = (data) => {
    const payload = JSON.stringify(data);
    return crypto
        .createHmac('sha256', config.clientSecret)
        .update(payload)
        .digest('hex');
};

const LinkQu = {
    /**
     * Fungsi Inti untuk Hit ke API LinkQu dengan Logging Detail
     */
    hitAPI: async (endpoint, data) => {
        const signature = generateSignature(data);
        const fullPayload = {
            ...data,
            username: config.username,
            pin: config.pin,
            signature
        };

        console.log(`[LinkQu-Request] 📤 POST ${endpoint}`);
        // console.log("Payload:", JSON.stringify(fullPayload, null, 2)); // Debugging internal

        try {
            const response = await axios.post(`${config.baseUrl}${endpoint}`, fullPayload, {
                headers: {
                    'client-id': config.clientId,
                    'client-secret': config.clientSecret,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            console.log(`[LinkQu-Response] 📥 SUCCESS - Code: ${response.data.response_code || response.data.status}`);
            return response.data;
        } catch (error) {
            const errorData = error.response?.data || error.message;
            console.error(`[LinkQu-Error] ❌ FAIL ${endpoint}:`, JSON.stringify(errorData));
            return errorData;
        }
    },

    /**
     * Membuat Transaksi Virtual Account
     */
    createVA: async (d) => {
        // 1. DAFTAR MAPPING BANK
        const bankMap = {
            'BNI': '009',
            'BRI': '002',
            'MANDIRI': '008',
            'BCA': '014',
            'PERMATA': '013',
            'VA_BNI': '009',
            'VA_BRI': '002',
            'VA_MANDIRI': '008',
            'VA_BCA': '014',
            'VA_PERMATA': '013'
        };

        // 2. Logika Fallback Kode Bank
        const finalBankCode = d.bank_code || bankMap[d.method?.toUpperCase()];

        if (!finalBankCode) {
            console.error(`[LinkQu-Util] ⚠️ Mapping Gagal. Method: ${d.method}, BankCode: ${d.bank_code}`);
            throw new Error(`Bank Code not found for method: ${d.method}`);
        }

        // 3. Susun Payload Sesuai Dokumentasi LinkQu
        const payload = {
            amount: String(d.amount),
            expired: d.expired,
            bank_code: finalBankCode,
            partner_reff: d.partner_reff,
            customer_id: d.customer_id,
            customer_name: d.customer_name,
            customer_email: d.customer_email,
            customer_phone: d.customer_phone,
            remark: d.remark || "Pembayaran VA",
            url_callback: d.url_callback
        };

        // Menggunakan LinkQu.hitAPI (bukan this.hitAPI agar lebih aman dalam konteks async)
        return await LinkQu.hitAPI('/transaction/create/va', payload);
    },

    /**
     * Membuat Transaksi QRIS
     */
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