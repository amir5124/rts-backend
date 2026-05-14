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
                    o.payment_method_id,
                    o.payment_method_name,
                    s.service_name,
                    p.external_id as payment_code,
                    p.partner_reff,
                    p.method as payment_method,
                    p.bank_code,
                    p.va_number,
                    p.qris_url as payment_url,
                    p.amount as payment_amount,
                    p.status as payment_status,
                    p.expired_at as payment_expiry,
                    p.paid_at
                FROM orders o
                LEFT JOIN payments p ON o.id = p.order_id
                LEFT JOIN services s ON o.service_id = s.id
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

            const formattedOrders = orders.map(order => ({
                id: order.id,
                order_code: order.order_code,
                status: order.status,
                total_amount: parseFloat(order.total_amount),
                scheduled_at: order.scheduled_at,
                service_info: {
                    id: order.service_id,
                    name: order.service_name  // Sekarang pakai service_name
                },
                location: {
                    address: order.address_google,
                    detail: order.address_detail,
                    latitude: order.latitude_dest ? parseFloat(order.latitude_dest) : null,
                    longitude: order.longitude_dest ? parseFloat(order.longitude_dest) : null
                },
                payment_details: order.payment_code ? {
                    code: order.payment_code,
                    partner_reff: order.partner_reff,
                    method: order.payment_method,
                    bank_code: order.bank_code,
                    va_number: order.va_number,
                    amount: parseFloat(order.payment_amount),
                    status: order.payment_status,
                    url: order.payment_url,
                    expiry: order.payment_expiry,
                    paid_at: order.paid_at
                } : null,
                payment_method_id: order.payment_method_id,
                payment_method_name: order.payment_method_name,
                created_at: order.created_at
            }));

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