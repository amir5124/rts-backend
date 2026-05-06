const axios = require('axios');
const crypto = require('crypto');

const config = {
    clientId: "5f5aa496-7e16-4ca1-9967-33c768dac6c7",
    clientSecret: "TM1rVhfaFm5YJxKruHo0nWMWC",
    username: "LI9019VKS",
    pin: "5m6uYAScSxQtCmU",
    serverKey: "QtwGEr997XDcmMb1Pq8S5X1N",
    baseUrl: 'https://api.linkqu.id/linkqu-partner'
};

const LinkQuUtility = {
    /**
     * hitLinkQu: Pengirim API dengan pengamanan signature yang ketat
     */
    hitLinkQu: async (endpoint, data, rawSig) => {
        try {
            // LinkQu mengharuskan signature dibuat dari string lowercase tanpa spasi
            const cleanSig = String(rawSig).replace(/\s+/g, "").toLowerCase();
            
            const signature = crypto.createHmac("sha256", config.serverKey)
                .update(endpoint + 'POST' + cleanSig)
                .digest("hex");

            // LOGGING LENGKAP UNTUK DEBUGGING
            console.log(`\n--- [LINKQU AUTH DEBUG] ---`);
            console.log(`📍 URL      : ${endpoint}`);
            console.log(`📝 Raw Sig  : ${rawSig}`);
            console.log(`🧼 Clean Sig: ${cleanSig}`);
            console.log(`🔑 Signature: ${signature}`);
            console.log(`---------------------------\n`);

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

    /**
     * Create Virtual Account
     */
    createVA: async (d) => {
        const bankMapping = {
            'VA BRI': '002', 'BRI': '002', 'VA_BRI': '002',
            'VA MANDIRI': '008', 'MANDIRI': '008',
            'VA BNI': '009', 'BNI': '009',
            'VA PERMATA': '013', 'PERMATA': '013',
            'VA BCA': '014', 'BCA': '014'
        };

        // 1. Normalisasi Data (Gunakan variabel lokal agar sinkron)
        const amount = String(d.amount);
        const expired = String(d.expired);
        const bank_code = String(bankMapping[d.method?.toUpperCase()] || bankMapping[d.bank_code?.toUpperCase()] || '002');
        const partner_reff = String(d.partner_reff);
        // Nama harus dibersihkan dari karakter aneh karena sering jadi penyebab gagal signature
        const customer_name = String(d.customer_name || "Customer").replace(/[^a-zA-Z0-9 ]/g, "").trim();
        const customer_email = String(d.customer_email || "guest@mail.com").trim();

        const payload = {
            amount,
            expired,
            bank_code,
            partner_reff,
            customer_id: String(d.customer_id || "CUST-001").replace(/[^a-zA-Z0-9]/g, ""),
            customer_name,
            customer_email,
            customer_phone: String(d.customer_phone || "081234567890").replace(/[^0-9]/g, ""),
            remark: "Pembayaran " + partner_reff,
            url_callback: d.url_callback || "https://api.siappgo.id/api/payments/callback"
        };

        // 2. Susun Signature (Urutan WAJIB: amount + expired + bank_code + partner_reff + nama + nama + email + client_id)
        const rawSig = payload.amount + 
                       payload.expired + 
                       payload.bank_code + 
                       payload.partner_reff + 
                       payload.customer_name + 
                       payload.customer_name + 
                       payload.customer_email + 
                       config.clientId;

        return await LinkQuUtility.hitLinkQu('/transaction/create/va', payload, rawSig);
    },

    /**
     * Create QRIS
     */
    createQRIS: async (d) => {
        const amount = String(d.amount);
        const expired = String(d.expired);
        const partner_reff = String(d.partner_reff);
        const customer_name = String(d.customer_name || "Customer").replace(/[^a-zA-Z0-9 ]/g, "").trim();
        const customer_email = String(d.customer_email || "guest@mail.com").trim();

        const payload = {
            amount,
            expired,
            partner_reff,
            customer_id: String(d.customer_id || "CUST-001").replace(/[^a-zA-Z0-9]/g, ""),
            customer_name,
            customer_phone: String(d.customer_phone || "081234567890").replace(/[^0-9]/g, ""),
            customer_email,
            url_callback: d.url_callback || "https://api.siappgo.id/api/payments/callback"
        };

        // Urutan QRIS: amount + expired + partner_reff + nama + nama + email + client_id
        const rawSig = payload.amount + 
                       payload.expired + 
                       payload.partner_reff + 
                       payload.customer_name + 
                       payload.customer_name + 
                       payload.customer_email + 
                       config.clientId;

        return await LinkQuUtility.hitLinkQu('/transaction/create/qris', payload, rawSig);
    }
};

module.exports = LinkQuUtility;