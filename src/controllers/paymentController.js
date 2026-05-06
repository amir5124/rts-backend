const axios = require('axios');
const crypto = require('crypto');
const moment = require('moment-timezone');
const db = require('../config/db');

// Gunakan Credential Production/Staging Anda
const config = {
    clientId: "5f5aa496-7e16-4ca1-9967-33c768dac6c7",
    clientSecret: "TM1rVhfaFm5YJxKruHo0nWMWC",
    username: "LI9019VKS",
    pin: "5m6uYAScSxQtCmU",
    serverKey: "QtwGEr997XDcmMb1Pq8S5X1N",
    baseUrl: 'https://api.linkqu.id/linkqu-partner'
};

/**
 * Signature Generator konsisten dengan standar LinkQu
 */
function generateSignature(path, method, data) {
    const rawValue = Object.values(data).join('') + config.clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    
    return crypto.createHmac("sha256", config.serverKey)
        .update(path + method + cleaned)
        .digest("hex");
}

const PaymentController = {
    requestPaymentGateway: async (payload, tx = null) => {
        const { order_id, order_code, amount, customer, method, bank_code } = payload;
        const client = tx || db;

        try {
            console.log(`\n--- 💳 [LINKQU PROCESS] Order: ${order_code} ---`);

            // 1. Standarisasi Data
            const finalAmount = Math.round(Number(amount));
            const finalCustomerName = (customer.name || 'Customer').substring(0, 30).trim();
            const finalCustomerEmail = (customer.email || 'guest@mail.com').trim();

            // 2. Format Nomor Telepon ke Standar +62 (Krusial untuk Signature)
            let formattedPhone = customer.phone ? customer.phone.toString().trim().replace(/[^0-9]/g, '') : '';
            if (formattedPhone.startsWith('0')) {
                formattedPhone = '+62' + formattedPhone.substring(1);
            } else if (!formattedPhone.startsWith('+') && formattedPhone.startsWith('62')) {
                formattedPhone = '+' + formattedPhone;
            } else if (!formattedPhone.startsWith('+')) {
                formattedPhone = '+62' + formattedPhone;
            }

            const partner_reff = `PAY-ORD-${order_code}`;
            const expired = moment.tz('Asia/Jakarta').add(2, 'hours').format('YYYYMMDDHHmmss');
            const url_callback = "https://api.siappgo.id/api/payments/callback";

            // 3. Persiapan Data Signature (URUTAN SANGAT PENTING)
            let endpoint = method === 'VA' ? '/transaction/create/va' : '/transaction/create/qris';
            
            let signatureData;
            if (method === 'VA') {
                // Urutan VA: amount, expired, bank_code, partner_reff, customer_id, customer_name, customer_email
                signatureData = {
                    amount: finalAmount,
                    expired,
                    bank_code: bank_code,
                    partner_reff,
                    customer_id: formattedPhone,
                    customer_name: finalCustomerName,
                    customer_email: finalCustomerEmail
                };
            } else {
                // Urutan QRIS: amount, expired, partner_reff, customer_id, customer_name, customer_email
                signatureData = {
                    amount: finalAmount,
                    expired,
                    partner_reff,
                    customer_id: formattedPhone,
                    customer_name: finalCustomerName,
                    customer_email: finalCustomerEmail
                };
            }

            const signature = generateSignature(endpoint, 'POST', signatureData);

            // 4. Payload Final untuk API
            const payloadLinkQu = {
                ...signatureData,
                username: config.username,
                pin: config.pin,
                url_callback,
                signature
            };

            console.log(`🚀 [LINKQU REQ] Sending to ${endpoint}`);
            console.log(`📦 Signature Data Source:`, JSON.stringify(signatureData));

            const resp = await axios.post(`${config.baseUrl}${endpoint}`, payloadLinkQu, {
                headers: { 
                    'client-id': config.clientId, 
                    'client-secret': config.clientSecret,
                    'Content-Type': 'application/json'
                }
            });

            console.log(`✅ [LINKQU RESP] Status:`, resp.data.status || resp.data.response_desc);

            const linkquData = resp.data;

            if (linkquData.status === 'FAILED' || linkquData.response_code === '501') {
                throw new Error(`LinkQu Error: ${linkquData.response_desc || 'Signature Invalid'}`);
            }

            const vaNumber = linkquData.virtual_account || linkquData.va_number || (linkquData.data?.va_number);
            const qrisUrl = linkquData.imageqris || linkquData.qr_url || (linkquData.data?.qr_url);

            if (!vaNumber && !qrisUrl) {
                throw new Error("Gagal mendapatkan kode pembayaran (Data Kosong)");
            }

            // 5. Simpan ke database menggunakan koneksi transaksi (tx)
            const mysqlExpired = moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss');
            await client.query(
                `INSERT INTO payments (order_id, partner_reff, method, bank_code, va_number, qris_url, amount, status, expired_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
                [order_id, partner_reff, method, bank_code, vaNumber, qrisUrl, finalAmount, mysqlExpired]
            );

            return { vaNumber, qrisUrl, partner_reff };

        } catch (error) {
            console.error(`❌ [LINKQU ERROR]:`, error.response?.data || error.message);
            // Lempar error agar OrderController melakukan ROLLBACK
            throw new Error(error.response?.data?.response_desc || error.message);
        }
    },

    handleCallback: async (req, res) => {
        console.log("📥 [CALLBACK RECEIVED]:", req.body);
        const { partner_reff, status } = req.body;
        const statusUpper = status?.toUpperCase();

        if (statusUpper === "SUCCESS" || statusUpper === "SETTLED") {
            try {
                const [rows] = await db.query("SELECT order_id FROM payments WHERE partner_reff = ?", [partner_reff]);
                if (rows.length > 0) {
                    const orderId = rows[0].order_id;
                    
                    // Gunakan Transaction untuk update ganda
                    const connection = await db.getConnection();
                    await connection.beginTransaction();
                    try {
                        await connection.query("UPDATE payments SET status = 'SUCCESS', paid_at = NOW() WHERE partner_reff = ?", [partner_reff]);
                        await connection.query("UPDATE orders SET status = 'paid' WHERE id = ?", [orderId]);
                        await connection.commit();
                        console.log(`✅ Order ${orderId} lunas via Callback.`);
                    } catch (err) {
                        await connection.rollback();
                        throw err;
                    } finally {
                        connection.release();
                    }
                }
            } catch (err) {
                console.error("❌ Callback DB Error:", err.message);
            }
        }
        return res.json({ message: "OK" });
    }
};

module.exports = PaymentController;