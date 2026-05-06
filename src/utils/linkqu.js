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

const hitLinkQu = async (endpoint, data, rawSig) => {
    // Logic Signature sesuai revisi kamu: endpoint + POST + clean alphanumeric rawSig
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
    createVA: async (d) => {
        // Mapping Bank Code (Sesuaikan jika bank_code sudah berupa angka dari payload)
        const bankMapping = { 'VA BRI': '002', 'VA MANDIRI': '008', 'VA BNI': '009', 'VA PERMATA': '013', 'VA BCA': '014' };
        const selectedBank = bankMapping[d.method.toUpperCase()] || d.bank_code;

        const payload = {
            amount: d.amount,
            expired: d.expired,
            bank_code: selectedBank,
            partner_reff: d.partner_reff,
            customer_id: String(d.customer_id),
            customer_name: d.customer_name.trim(),
            customer_email: d.customer_email,
            customer_phone: d.customer_phone,
            remark: "Pembayaran " + d.partner_reff,
            url_callback: d.url_callback
        };

        // Urutan VA: amount + expired + bank_code + partner_reff + nama + nama + email + client_id
        const rawSig = payload.amount + payload.expired + payload.bank_code + payload.partner_reff + 
                       payload.customer_name + payload.customer_name + payload.customer_email + config.clientId;

        return await hitLinkQu('/transaction/create/va', payload, rawSig);
    },

    createQRIS: async (d) => {
        const payload = {
            amount: d.amount,
            expired: d.expired,
            partner_reff: d.partner_reff,
            customer_id: String(d.customer_id),
            customer_name: d.customer_name.trim(),
            customer_email: d.customer_email,
            customer_phone: d.customer_phone,
            url_callback: d.url_callback
        };

        // Urutan QRIS: amount + expired + partner_reff + nama + nama + email + client_id
        const rawSig = payload.amount + payload.expired + payload.partner_reff + 
                       payload.customer_name + payload.customer_name + payload.customer_email + config.clientId;

        return await hitLinkQu('/transaction/create/qris', payload, rawSig);
    }
};