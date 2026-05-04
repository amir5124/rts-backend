const db = require('../config/db');
const PaymentController = require('./paymentController');

const OrderController = {
    createOrder: async (req, res) => {
        let connection;
        try {
            // Log Payload untuk Debugging
            console.log("--- 📥 Payload Masuk ---");
            console.log(JSON.stringify(req.body, null, 2));

            const { 
                customer_id, 
                mitra_id, 
                service_id, // Ambil service_id
                location_info, // Ambil info lokasi
                latitude_dest, // Ambil latitude
                longitude_dest, // Ambil longitude
                order_info, 
                payment_info 
            } = req.body;

            connection = await db.getConnection();
            await connection.beginTransaction();

            const orderCode = `ORD-${Date.now()}`;
            
            // 1. Simpan ke tabel orders (Menambahkan kolom yang kurang)
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
                ) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?)`;

            const valuesInsert = [
                orderCode, 
                customer_id, 
                mitra_id, 
                service_id || null,             // Dari payload
                order_info.durasi,              // Dari payload
                order_info.total_bayar, 
                order_info.rincian_biaya.transport, 
                order_info.rincian_biaya.admin, 
                order_info.scheduled_at,
                latitude_dest,                  // Dari payload
                longitude_dest,                 // Dari payload
                location_info.address_google,   // Dari payload
                location_info.address_detail,   // Dari payload
                location_info.note || "",       // Dari payload
                payment_info.method             // Simpan kode bank/metode ke DB
            ];

            console.log("--- 🚀 Menjalankan Query Insert ---");
            const [orderResult] = await connection.query(queryInsert, valuesInsert);

            const orderId = orderResult.insertId;
            console.log("✅ Order Berhasil Disimpan, ID:", orderId);

            // 2. Ambil data customer untuk keperluan Payment Gateway
            const [customerRows] = await connection.query("SELECT name, phone, email FROM users WHERE id = ?", [customer_id]);
            const customer = customerRows[0];

            if (!customer) {
                throw new Error(`Customer dengan ID ${customer_id} tidak ditemukan di database.`);
            }

            // 3. Panggil Payment Controller (Orkestrasi)
            console.log("--- 💳 Meminta Session Payment Gateway ---");
            const paymentResult = await PaymentController.requestPaymentGateway({
                order_id: orderId,
                order_code: orderCode,
                amount: order_info.total_bayar,
                customer: customer,
                method: payment_info.method_type, // 'VA' atau 'QRIS'
                bank_code: payment_info.method    // kode bank jika VA
            });

            await connection.commit();
            console.log("✨ Transaksi Berhasil Diselesaikan!");

            res.json({
                success: true,
                order_code: orderCode,
                payment_info: paymentResult
            });

        } catch (error) {
            if (connection) await connection.rollback();
            
            // Log Error Detail
            console.error("--- ❌ Order Error Detail ---");
            console.error("Message:", error.message);
            if (error.code) console.error("DB Error Code:", error.code);
            
            res.status(500).json({ 
                success: false, 
                message: error.message,
                db_error_code: error.code // Kirim kode error DB ke frontend untuk debug
            });
        } finally {
            if (connection) connection.release();
        }
    }
};

module.exports = OrderController;