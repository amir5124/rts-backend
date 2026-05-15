const db = require('../config/db');
const PaymentController = require('./paymentController');

const OrderController = {
    // 1. FUNGSI CREATE ORDER (KODE ASLI ANDA)
    createOrder: async (req, res) => {
        let connection;
        const orderCode = `ORD-${Date.now()}`;

        try {
            console.log(`\n--- 🏁 MEMULAI PROSES ORDER: ${orderCode} ---`);

            const {
                customer_id, mitra_id, service_id, location_info,
                latitude_dest, longitude_dest, order_info, payment_info
            } = req.body;

            // 1. Ambil koneksi dari pool
            connection = await db.getConnection();
            console.log("DB: Koneksi didapatkan.");

            // 2. Start Transaction
            await connection.beginTransaction();
            console.log("DB: Transaksi dimulai.");

            // 3. Simpan ke tabel orders
            const queryInsert = `
                INSERT INTO orders (
                    order_code, 
                    customer_id, 
                    mitra_id, 
                    service_id, 
                    duration,
                    total_amount, 
                    transport_fee, 
                    admin_fee, 
                    status,
                    scheduled_at,
                    latitude_dest,
                    longitude_dest,
                    address_google,
                    address_detail,
                    note,
                    payment_method_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            const valuesInsert = [
                orderCode,
                customer_id,
                mitra_id,
                service_id || null,
                order_info.durasi,
                order_info.total_bayar,
                order_info.rincian_biaya.transport,
                order_info.rincian_biaya.admin,
                'pending_payment',
                order_info.scheduled_at,
                latitude_dest,
                longitude_dest,
                location_info.address_google,
                location_info.address_detail,
                location_info.note || "",
                payment_info.method
            ];

            console.log("--- 🚀 Menjalankan Query Insert ---");

            const [orderResult] = await connection.query(queryInsert, valuesInsert);
            const orderId = orderResult.insertId;
            console.log(`DB: Order disimpan (ID: ${orderId}).`);

            // 4. Ambil data customer
            const [customerRows] = await connection.query(
                "SELECT name, phone, email FROM users WHERE id = ? FOR UPDATE",
                [customer_id]
            );
            const customer = customerRows[0];

            if (!customer) throw new Error("Customer tidak ditemukan.");

            // 5. Panggil Payment Gateway
            console.log("API: Meminta session ke LinkQu...");
            const paymentResult = await PaymentController.requestPaymentGateway({
                order_id: orderId,
                order_code: orderCode,
                amount: order_info.total_bayar,
                customer: customer,
                method: payment_info.method_type,
                bank_code: payment_info.method
            }, connection);

            // 6. Jika semua sukses, baru Commit
            await connection.commit();
            console.log("DB: Transaksi BERHASIL di-commit.");

            return res.json({
                success: true,
                order_code: orderCode,
                payment_info: paymentResult
            });

        } catch (error) {
            if (connection) {
                console.error("DB: Terjadi kesalahan, melakukan Rollback...");
                await connection.rollback();
            }

            console.error(`❌ ORDER GAGAL [${orderCode}]:`, error.message);

            return res.status(500).json({
                success: false,
                message: error.message
            });

        } finally {
            if (connection) {
                connection.release();
                console.log("DB: Koneksi dilepaskan ke pool.");
                console.log("--- 🔚 SELESAI ---\n");
            }
        }
    },

    // 2. FUNGSI GET ORDER BY CUSTOMER (DIPERBAIKI)
    getOrdersByCustomer: async (req, res) => {
        let connection;
        const { customer_id } = req.params;

        const getBankName = (bankCode) => {
            const bankMap = {
                '002': 'BANK BRI',
                '008': 'BANK MANDIRI',
                '009': 'BANK BNI',
                '014': 'BANK BCA',
                '022': 'BANK CIMB NIAGA',
                'qris': 'QRIS'
            };
            return bankMap[bankCode] || bankCode || 'Virtual Account';
        };

        try {
            connection = await db.getConnection();

            const query = `
                SELECT 
                    o.id,
                    o.order_code,
                    o.status,
                    o.total_amount,
                    o.scheduled_at,
                    o.service_id,
                    o.created_at,
                    o.address_google,
                    o.address_detail,
                    o.latitude_dest,
                    o.longitude_dest,
                    o.mitra_id,
                    o.confirmed_at_mitra,
                    o.confirmed_at_customer,
                    o.note,
                    s.service_name,
                    s.base_price,
                    -- Informasi Mitra/Terapis
                    u.name as mitra_name,
                    u.phone as mitra_phone,
                    u.profile_pic as mitra_profile_pic,
                    md.specialization,
                    md.is_verified as mitra_is_verified,
                    md.is_online as mitra_is_online,
                    md.avg_rating as mitra_rating,
                    md.certificate_url,
                    -- Informasi Payment
                    p.external_id as payment_code,
                    p.partner_reff,
                    p.method as payment_method,
                    p.bank_code,
                    p.va_number,
                    p.qris_url,
                    p.amount as payment_amount,
                    p.status as payment_status,
                    p.expired_at as payment_expiry,
                    p.paid_at
                FROM orders o
                LEFT JOIN services s ON o.service_id = s.id
                LEFT JOIN users u ON o.mitra_id = u.id
                LEFT JOIN mitra_details md ON u.id = md.user_id
                LEFT JOIN payments p ON o.id = p.order_id
                WHERE o.customer_id = ?
                ORDER BY o.created_at DESC
            `;

            const [orders] = await connection.query(query, [customer_id]);

            if (orders.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Belum ada riwayat pesanan untuk customer ini."
                });
            }

            const formattedOrders = orders.map(order => {
                // Format payment details
                let paymentDetails = null;

                if (order.payment_code) {
                    const isQris = order.payment_method === 'QR' || order.bank_code === 'qris';

                    paymentDetails = {
                        code: order.payment_code,
                        partner_reff: order.partner_reff,
                        method: order.payment_method,
                        amount: parseFloat(order.payment_amount),
                        status: order.payment_status,
                        expiry: order.payment_expiry,
                        paid_at: order.paid_at
                    };

                    if (!isQris && order.va_number) {
                        paymentDetails.bank = {
                            code: order.bank_code,
                            name: getBankName(order.bank_code)
                        };
                        paymentDetails.virtual_account = order.va_number;
                    }

                    if (isQris && order.qris_url) {
                        paymentDetails.qris_url = order.qris_url;
                    }
                }

                return {
                    id: order.id,
                    order_code: order.order_code,
                    status: order.status,
                    total_amount: parseFloat(order.total_amount),
                    scheduled_at: order.scheduled_at,
                    note: order.note,
                    service_info: {
                        id: order.service_id,
                        name: order.service_name,
                        base_price: parseFloat(order.base_price)
                    },
                    mitra_info: order.mitra_id ? {
                        id: order.mitra_id,
                        name: order.mitra_name,
                        phone: order.mitra_phone,
                        profile_pic: order.mitra_profile_pic,
                        rating: parseFloat(order.mitra_rating) || 0,
                        is_verified: order.mitra_is_verified === 1,
                        is_online: order.mitra_is_online === 1,
                        specialization: order.specialization,
                        certificate_url: order.certificate_url
                    } : null,
                    location: {
                        address: order.address_google,
                        detail: order.address_detail,
                        latitude: order.latitude_dest ? parseFloat(order.latitude_dest) : null,
                        longitude: order.longitude_dest ? parseFloat(order.longitude_dest) : null
                    },
                    confirmation: {
                        mitra_confirmed_at: order.confirmed_at_mitra,
                        customer_confirmed_at: order.confirmed_at_customer
                    },
                    payment_details: paymentDetails,
                    created_at: order.created_at
                };
            });

            return res.json({
                success: true,
                count: formattedOrders.length,
                data: formattedOrders
            });

        } catch (error) {
            console.error(`❌ GAGAL MENGAMBIL DATA ORDER [Customer: ${customer_id}]:`, error.message);
            return res.status(500).json({
                success: false,
                message: "Terjadi kesalahan pada server saat mengambil data order."
            });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }
}

module.exports = OrderController;