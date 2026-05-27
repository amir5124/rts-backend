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
 * Signature Generator
 */
const generateSignature = (endpoint, method, data) => {
    const rawValue = Object.values(data).join('') + config.clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();

    return crypto
        .createHmac('sha256', config.serverKey)
        .update(endpoint + method + cleaned)
        .digest('hex');
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

    /**
     * Buat Virtual Account
     */
    createVA: async (d) => {
        const bankMapping = {
            'VA BRI': '002', 'VA_BRI': '002', 'VA-BRI': '002',
            'va bri': '002', 'va_bri': '002', 'va-bri': '002',
            'BRI': '002', 'bri': '002',
            'VA MANDIRI': '008', 'VA_MANDIRI': '008', 'VA-MANDIRI': '008',
            'va mandiri': '008', 'va_mandiri': '008', 'va-mandiri': '008',
            'MANDIRI': '008', 'mandiri': '008',
            'VA BNI': '009', 'VA_BNI': '009', 'VA-BNI': '009',
            'va bni': '009', 'va_bni': '009', 'va-bni': '009',
            'BNI': '009', 'bni': '009',
            'VA PERMATA': '013', 'VA_PERMATA': '013', 'VA-PERMATA': '013',
            'va permata': '013', 'va_permata': '013', 'va-permata': '013',
            'PERMATA': '013', 'permata': '013',
            'VA BCA': '014', 'VA_BCA': '014', 'VA-BCA': '014',
            'va bca': '014', 'va_bca': '014', 'va-bca': '014',
            'BCA': '014', 'bca': '014',
        };

        const endpoint = '/transaction/create/va';
        const method = 'POST';

        const amount = String(Math.round(Number(d.amount)));
        const expired = String(d.expired);

        const methodKey = d.method || d.bank_code || '';
        const bank_code = String(bankMapping[methodKey] || bankMapping[methodKey?.toLowerCase()] || d.bank_code || '002');

        console.log(`[LinkQu] 🏦 method="${methodKey}" → bank_code="${bank_code}"`);

        const partner_reff = String(d.partner_reff);
        const customer_id = String(d.customer_id || 'CUST-001');
        const customer_name = String(d.customer_name || 'Customer').substring(0, 30).trim();
        const customer_email = String(d.customer_email || 'guest@mail.com').trim();

        let customer_phone = String(d.customer_phone || '081234567890').replace(/[^0-9]/g, '');
        if (customer_phone.startsWith('0')) customer_phone = '62' + customer_phone.substring(1);
        else if (customer_phone.startsWith('8')) customer_phone = '62' + customer_phone;
        if (customer_phone.length < 10) customer_phone = '628123456789';

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
            remark: 'Payment ' + partner_reff,
            url_callback: d.url_callback || 'https://api.siappgo.id/api/v1/payments/callback',
            username: config.username,
            pin: config.pin,
            signature
        };

        console.log(`[LinkQu] 🚀 createVA → ${endpoint}`);
        console.log(`[LinkQu] 🔑 Signature:`, signature);

        return await LinkQuUtility.hitLinkQu(endpoint, finalBody);
    },

    /**
     * Buat QRIS
     */
    createQRIS: async (d) => {
        const endpoint = '/transaction/create/qris';
        const method = 'POST';

        const amount = String(Math.round(Number(d.amount)));
        const expired = String(d.expired);
        const partner_reff = String(d.partner_reff);
        const customer_id = String(d.customer_id || 'CUST-001');
        const customer_name = String(d.customer_name || 'Customer').substring(0, 30).trim();
        const customer_email = String(d.customer_email || 'guest@mail.com').trim();

        let customer_phone = String(d.customer_phone || '081234567890').replace(/[^0-9]/g, '');
        if (customer_phone.startsWith('0')) customer_phone = '62' + customer_phone.substring(1);
        else if (customer_phone.startsWith('8')) customer_phone = '62' + customer_phone;
        if (customer_phone.length < 10) customer_phone = '628123456789';

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
            customer_phone,
            url_callback: d.url_callback || 'https://api.siappgo.id/api/v1/payments/callback',
            username: config.username,
            pin: config.pin,
            signature
        };

        console.log(`[LinkQu] 🚀 createQRIS → ${endpoint}`);
        console.log(`[LinkQu] 🔑 Signature:`, signature);

        return await LinkQuUtility.hitLinkQu(endpoint, finalBody);
    },

    // utils/linkqu.js - Tambahkan/Update fungsi checkStatus

    /**
     * 🔥 PERBAIKAN: Check Status Pembayaran (Menggunakan GET method)
     * Mengikuti pola yang berhasil di project lain
     */
    // utils/linkqu.js
    checkStatus: async (partnerReff) => {
        try {
            console.log(`[LinkQu] 🔍 Checking status for reff: ${partnerReff}`);

            // 🔥 PERBAIKAN: Gunakan endpoint yang benar sesuai dokumentasi
            // Coba endpoint yang berbeda
            const endpoints = [
                '/transaction/inquiry',
                '/transaction/payment/checkstatus',
                '/v1/transaction/status'
            ];

            let lastError = null;

            for (const endpoint of endpoints) {
                try {
                    const signatureData = {
                        partner_reff: String(partnerReff)
                    };

                    const signature = generateSignature(endpoint, 'POST', signatureData);

                    const payload = {
                        partner_reff: String(partnerReff),
                        username: config.username,
                        pin: config.pin,
                        signature: signature
                    };

                    console.log(`[LinkQu] Trying endpoint: ${endpoint}`);
                    console.log(`[LinkQu] Payload:`, JSON.stringify(payload, null, 2));

                    const response = await axios.post(`${config.baseUrl}${endpoint}`, payload, {
                        headers: {
                            'client-id': config.clientId,
                            'client-secret': config.clientSecret,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15000
                    });

                    if (response.data && (response.data.rc === '00' || response.data.status === 'SUCCESS')) {
                        console.log(`[LinkQu] ✅ Success with endpoint: ${endpoint}`);
                        return response.data;
                    }

                    lastError = response.data;
                } catch (endpointError) {
                    lastError = endpointError.response?.data || endpointError.message;
                    console.log(`[LinkQu] Endpoint ${endpoint} failed:`, lastError);
                }
            }

            // Jika semua endpoint gagal, return error
            return {
                rc: '404',
                rd: lastError?.rd || lastError?.message || 'Transaksi tidak ditemukan',
                total: 0,
                data: {}
            };

        } catch (error) {
            const errorData = error.response?.data || error.message;
            console.error(`[LinkQu] ❌ Status check error:`, errorData);

            return {
                rc: '500',
                rd: error.response?.data?.message || error.message || 'Gagal mengecek status',
                total: 0,
                data: {}
            };
        }
    },

    /**
     * 🔥 TAMBAHAN: Inquiry transaksi dengan POST (alternatif)
     */
    inquiryTransaction: async (partnerReff) => {
        const endpoint = '/transaction/inquiry';
        const method = 'POST';

        try {
            const signatureData = {
                partner_reff: String(partnerReff)
            };

            const signature = generateSignature(endpoint, method, signatureData);

            const payload = {
                partner_reff: String(partnerReff),
                username: config.username,
                pin: config.pin,
                signature: signature
            };

            const response = await axios.post(`${config.baseUrl}${endpoint}`, payload, {
                headers: {
                    'client-id': config.clientId,
                    'client-secret': config.clientSecret,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            return response.data;

        } catch (error) {
            console.error(`[LinkQu] ❌ Inquiry error:`, error.message);
            return null;
        }
    },

    /**
     * 🔥 TAMBAHAN: Get Transaction Detail
     * Untuk mendapatkan detail transaksi
     */
    getTransactionDetail: async (partner_reff) => {
        const endpoint = '/transaction/detail';
        const method = 'POST';

        try {
            const signatureData = {
                partner_reff: String(partner_reff)
            };

            const signature = generateSignature(endpoint, method, signatureData);

            const payload = {
                partner_reff: String(partner_reff),
                username: config.username,
                pin: config.pin,
                signature: signature
            };

            const response = await axios.post(`${config.baseUrl}${endpoint}`, payload, {
                headers: {
                    'client-id': config.clientId,
                    'client-secret': config.clientSecret,
                    'Content-Type': 'application/json'
                }
            });

            return response.data;

        } catch (error) {
            console.error(`[LinkQu] ❌ Detail error:`, error.message);
            return null;
        }
    },

    /**
     * 🔥 TAMBAHAN: Cancel Transaction
     * Untuk membatalkan transaksi
     */
    cancelTransaction: async (partner_reff) => {
        const endpoint = '/transaction/cancel';
        const method = 'POST';

        try {
            const signatureData = {
                partner_reff: String(partner_reff)
            };

            const signature = generateSignature(endpoint, method, signatureData);

            const payload = {
                partner_reff: String(partner_reff),
                username: config.username,
                pin: config.pin,
                signature: signature
            };

            const response = await axios.post(`${config.baseUrl}${endpoint}`, payload, {
                headers: {
                    'client-id': config.clientId,
                    'client-secret': config.clientSecret,
                    'Content-Type': 'application/json'
                }
            });

            return response.data;

        } catch (error) {
            console.error(`[LinkQu] ❌ Cancel error:`, error.message);
            return null;
        }
    }
};

module.exports = LinkQuUtility;