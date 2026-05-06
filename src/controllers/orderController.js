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
        order_code, 
        customer_id, 
        mitra_id, 
        service_id, 
        duration,
        total_amount, 
        transport_fee, 
        admin_fee, 
        status,           -- Kolom status di urutan ke-9
        scheduled_at,     -- Kolom scheduled_at di urutan ke-10
        latitude_dest,
        longitude_dest,
        address_google,
        address_detail,
        note,
        payment_method_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`; // Total 16 parameter

            const valuesInsert = [
                orderCode,                      // order_code
                customer_id,                    // customer_id
                mitra_id,                       // mitra_id
                service_id || null,             // service_id
                order_info.durasi,              // duration
                order_info.total_bayar,         // total_amount
                order_info.rincian_biaya.transport, // transport_fee
                order_info.rincian_biaya.admin,     // admin_fee
                'pending_payment',              // status (PAS dengan kolom ke-9)
                order_info.scheduled_at,        // scheduled_at (PAS dengan kolom ke-10)
                latitude_dest,                  // latitude_dest
                longitude_dest,                 // longitude_dest
                location_info.address_google,   // address_google
                location_info.address_detail,   // address_detail
                location_info.note || "",       // note
                payment_info.method             // payment_method_id
            ];

            console.log("--- 🚀 Menjalankan Query Insert ---");


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