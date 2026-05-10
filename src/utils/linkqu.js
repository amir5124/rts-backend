const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const config = {
    clientId: "testing",
    clientSecret: "123",
    username: "LI307GXIN",
    pin: "2K2NPCBBNNTovgB",
    serverKey: "LinkQu@2020",      // ← Digunakan sebagai HMAC key (bukan clientSecret)
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
 * Signature Generator — sama persis dengan HotelPaymentController
 *
 * Algoritma:
 * 1. Ambil semua VALUES dari objek data (urutan field penting!)
 * 2. Gabungkan semua value menjadi satu string, lalu tambahkan clientId di akhir
 * 3. Bersihkan: hapus semua karakter non-alphanumeric, ubah jadi lowercase
 * 4. HMAC-SHA256 dengan key = serverKey, input = endpoint + method + cleaned
 */
const generateSignature = (endpoint, method, data) => {
    // Gabungkan semua value + clientId
    const rawValue = Object.values(data).join('') + config.clientId;

    // Bersihkan: hanya huruf dan angka, semua lowercase
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
     * Urutan field untuk signature HARUS sama persis seperti di sini
     */
    createVA: async (d) => {
        // Mapping semua variasi key: uppercase, lowercase, dengan spasi/underscore/dash
        const bankMapping = {
            // BRI
            'VA BRI': '002', 'VA_BRI': '002', 'VA-BRI': '002',
            'va bri': '002', 'va_bri': '002', 'va-bri': '002',
            'BRI': '002', 'bri': '002',
            // MANDIRI
            'VA MANDIRI': '008', 'VA_MANDIRI': '008', 'VA-MANDIRI': '008',
            'va mandiri': '008', 'va_mandiri': '008', 'va-mandiri': '008',
            'MANDIRI': '008', 'mandiri': '008',
            // BNI
            'VA BNI': '009', 'VA_BNI': '009', 'VA-BNI': '009',
            'va bni': '009', 'va_bni': '009', 'va-bni': '009',
            'BNI': '009', 'bni': '009',
            // PERMATA
            'VA PERMATA': '013', 'VA_PERMATA': '013', 'VA-PERMATA': '013',
            'va permata': '013', 'va_permata': '013', 'va-permata': '013',
            'PERMATA': '013', 'permata': '013',
            // BCA
            'VA BCA': '014', 'VA_BCA': '014', 'VA-BCA': '014',
            'va bca': '014', 'va_bca': '014', 'va-bca': '014',
            'BCA': '014', 'bca': '014',
        };

        const endpoint = '/transaction/create/va';
        const method = 'POST';

        const amount = String(Math.round(Number(d.amount)));
        const expired = String(d.expired);

        // Cari bank_code dari method (id frontend) atau bank_code langsung
        const methodKey = d.method || d.bank_code || '';
        const bank_code = String(bankMapping[methodKey] || bankMapping[methodKey?.toLowerCase()] || d.bank_code || '002');

        console.log(`[LinkQu] 🏦 method="${methodKey}" → bank_code="${bank_code}"`);
        const partner_reff = String(d.partner_reff);
        const customer_id = String(d.customer_id || 'CUST-001');
        const customer_name = String(d.customer_name || 'Customer').substring(0, 30).trim();
        const customer_email = String(d.customer_email || 'guest@mail.com').trim();

        // Format phone: hanya angka, prefiks 62
        let customer_phone = String(d.customer_phone || '081234567890').replace(/[^0-9]/g, '');
        if (customer_phone.startsWith('0')) customer_phone = '62' + customer_phone.substring(1);
        else if (customer_phone.startsWith('8')) customer_phone = '62' + customer_phone;
        if (customer_phone.length < 10) customer_phone = '628123456789';

        // Data untuk signature — urutan field PENTING
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
            url_callback: d.url_callback || 'https://api.siappgo.id/api/payments/callback',
            username: config.username,
            pin: config.pin,
            signature
        };

        console.log(`[LinkQu] 🚀 createVA → ${endpoint}`);
        console.log(`[LinkQu] 📦 Signature Input Data:`, signatureData);
        console.log(`[LinkQu] 🔑 Signature:`, signature);

        return await LinkQuUtility.hitLinkQu(endpoint, finalBody);
    },

    /**
     * Buat QRIS
     * Urutan field untuk signature HARUS sama persis seperti di sini
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

        // Data untuk signature — urutan field PENTING
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
            url_callback: d.url_callback || 'https://api.siappgo.id/api/payments/callback',
            username: config.username,
            pin: config.pin,
            signature
        };

        console.log(`[LinkQu] 🚀 createQRIS → ${endpoint}`);
        console.log(`[LinkQu] 📦 Signature Input Data:`, signatureData);
        console.log(`[LinkQu] 🔑 Signature:`, signature);

        return await LinkQuUtility.hitLinkQu(endpoint, finalBody);
    }
};

module.exports = LinkQuUtility;