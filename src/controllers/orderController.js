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
    // 2. FUNGSI GET ORDER BY CUSTOMER (DIPERBAIKI - TANPA base_price)
    getOrdersByCustomer: async (req, res) => {
        let connection;
        const { customer_id } = req.params;

        // Mapping bank code ke nama bank
        const getBankName = (bankCode) => {
            const bankMap = {
                '002': 'BANK BRI',
                '008': 'BANK MANDIRI',
                '009': 'BANK BNI',
                '014': 'BANK BCA',
                '022': 'BANK CIMB NIAGA',
                'qris': 'QRIS'
            };
            return bankMap[bankCode] || null;
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
                o.duration,
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
                s.description as service_description,
                -- Informasi Mitra/Terapis
                u.name as mitra_name,
                u.phone as mitra_phone,
                u.profile_pic as mitra_profile_pic,
                md.specialization,
                md.is_verified as mitra_is_verified,
                md.is_online as mitra_is_online,
                md.certificate_url,
                -- Informasi Payment
                p.id as payment_id,
                p.partner_reff,
                p.external_id,
                p.method as payment_method,
                p.bank_code,
                p.va_number,
                p.qris_url,
                p.amount as payment_amount,
                p.fee_admin_pg,
                p.status as payment_status,
                p.expired_at as payment_expiry,
                p.paid_at,
                p.created_at as payment_created_at
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

            // Hitung rata-rata rating untuk setiap mitra
            const formattedOrders = await Promise.all(orders.map(async (order) => {
                // Hitung rata-rata rating mitra jika ada
                let mitraRating = 0;
                if (order.mitra_id) {
                    const [ratingResult] = await connection.query(
                        "SELECT COALESCE(AVG(rating), 0) as avg_rating FROM reviews WHERE mitra_id = ?",
                        [order.mitra_id]
                    );
                    mitraRating = parseFloat(ratingResult[0]?.avg_rating) || 0;
                }

                // Ambil harga dari service_prices berdasarkan service_id dan duration
                let servicePrice = 0;
                if (order.service_id && order.duration) {
                    const [priceResult] = await connection.query(
                        "SELECT price FROM service_prices WHERE service_id = ? AND duration = ?",
                        [order.service_id, order.duration]
                    );
                    servicePrice = parseFloat(priceResult[0]?.price) || 0;
                }

                // Format payment details
                let paymentDetails = null;

                if (order.payment_id || order.partner_reff) {
                    paymentDetails = {
                        id: order.payment_id,
                        partner_reff: order.partner_reff,
                        external_id: order.external_id,
                        method: order.payment_method,
                        status: order.payment_status,
                        amount: parseFloat(order.payment_amount) || parseFloat(order.total_amount),
                        fee_admin: parseFloat(order.fee_admin_pg) || 0,
                        expired_at: order.payment_expiry,
                        paid_at: order.paid_at,
                        created_at: order.payment_created_at
                    };

                    // Data spesifik berdasarkan metode pembayaran
                    if (order.payment_method === 'VA' && order.va_number) {
                        paymentDetails.virtual_account = {
                            bank_code: order.bank_code,
                            bank_name: getBankName(order.bank_code),
                            va_number: order.va_number
                        };
                    }
                    else if (order.payment_method === 'QR' && order.qris_url) {
                        paymentDetails.qris = {
                            qris_url: order.qris_url
                        };
                    }
                }

                return {
                    id: order.id,
                    order_code: order.order_code,
                    status: order.status,
                    total_amount: parseFloat(order.total_amount),
                    scheduled_at: order.scheduled_at,
                    note: order.note,
                    duration: order.duration,

                    // Service Info
                    service: {
                        id: order.service_id,
                        name: order.service_name,
                        description: order.service_description,
                        price: servicePrice
                    },

                    // Mitra Info
                    mitra: order.mitra_id ? {
                        id: order.mitra_id,
                        name: order.mitra_name,
                        phone: order.mitra_phone,
                        profile_pic: order.mitra_profile_pic,
                        rating: mitraRating,
                        is_verified: Boolean(order.mitra_is_verified),
                        is_online: Boolean(order.mitra_is_online),
                        specialization: order.specialization,
                        certificate_url: order.certificate_url
                    } : null,

                    // Location Info
                    location: {
                        address: order.address_google,
                        detail: order.address_detail,
                        latitude: order.latitude_dest ? parseFloat(order.latitude_dest) : null,
                        longitude: order.longitude_dest ? parseFloat(order.longitude_dest) : null
                    },

                    // Status Confirmation
                    confirmations: {
                        mitra_confirmed_at: order.confirmed_at_mitra,
                        customer_confirmed_at: order.confirmed_at_customer
                    },

                    // Payment Info
                    payment: paymentDetails,

                    // Metadata
                    created_at: order.created_at
                };
            }));

            return res.json({
                success: true,
                code: 200,
                message: "Riwayat pesanan berhasil ditemukan",
                data: {
                    total: formattedOrders.length,
                    orders: formattedOrders
                }
            });

        } catch (error) {
            console.error(`❌ GAGAL MENGAMBIL DATA ORDER [Customer: ${customer_id}]:`, error.message);
            return res.status(500).json({
                success: false,
                code: 500,
                message: "Terjadi kesalahan pada server",
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }
}

module.exports = OrderController;