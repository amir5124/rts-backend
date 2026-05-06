const db = require('../config/db');
const PaymentController = require('./paymentController');

const OrderController = {
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
                    order_code, customer_id, mitra_id, service_id, duration,
                    total_amount, transport_fee, admin_fee, status, scheduled_at,
                    latitude_dest, longitude_dest, address_google, address_detail,
                    note, payment_method_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?)`;

            const valuesInsert = [
                orderCode, customer_id, mitra_id, service_id || null, order_info.durasi, 
                order_info.total_bayar, order_info.rincian_biaya.transport, order_info.rincian_biaya.admin, 
                'pending_payment', order_info.scheduled_at, latitude_dest, longitude_dest, 
                location_info.address_google, location_info.address_detail, location_info.note || "", 
                payment_info.method 
            ];

            const [orderResult] = await connection.query(queryInsert, valuesInsert);
            const orderId = orderResult.insertId;
            console.log(`DB: Order disimpan (ID: ${orderId}).`);

            // 4. Ambil data customer (Masih pakai connection yang sama)
            const [customerRows] = await connection.query(
                "SELECT name, phone, email FROM users WHERE id = ? FOR UPDATE", 
                [customer_id]
            );
            const customer = customerRows[0];

            if (!customer) throw new Error("Customer tidak ditemukan.");

            // 5. Panggil Payment Gateway (KIRIM KONEKSI connection/tx)
            console.log("API: Meminta session ke LinkQu...");
            const paymentResult = await PaymentController.requestPaymentGateway({
                order_id: orderId,
                order_code: orderCode,
                amount: order_info.total_bayar,
                customer: customer,
                method: payment_info.method_type,
                bank_code: payment_info.method
            }, connection); // <--- INI KUNCINYA

            // 6. Jika semua sukses, baru Commit
            await connection.commit();
            console.log("DB: Transaksi BERHASIL di-commit.");

            return res.json({
                success: true,
                order_code: orderCode,
                payment_info: paymentResult
            });

        } catch (error) {
            // Rollback jika terjadi kegagalan di tahap manapun
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
            // Apapun yang terjadi, lepaskan koneksi
            if (connection) {
                connection.release();
                console.log("DB: Koneksi dilepaskan ke pool.");
                console.log("--- 🔚 SELESAI ---\n");
            }
        }
    }
};

module.exports = OrderController;