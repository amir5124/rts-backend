const db = require('../config/db');
const PaymentController = require('./paymentController');

const OrderController = {
    createOrder: async (req, res) => {
        let connection;
        let orderCode = `ORD-${Date.now()}`; // Pindahkan ke atas agar bisa diakses di catch/log

        try {
            // Log Payload untuk Debugging
            console.log("--- 📥 Payload Masuk ---");
            console.log(JSON.stringify(req.body, null, 2));

            const { 
                customer_id, 
                mitra_id, 
                service_id, 
                location_info, 
                latitude_dest, 
                longitude_dest, 
                order_info, 
                payment_info 
            } = req.body;

            connection = await db.getConnection();
            
            // Memulai Transaksi
            await connection.beginTransaction();

            // 1. Simpan ke tabel orders
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
                service_id || null, 
                order_info.durasi, 
                order_info.total_bayar, 
                order_info.rincian_biaya.transport, 
                order_info.rincian_biaya.admin, 
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

            // Commit Transaksi jika semua berhasil
            await connection.commit();
            console.log("✨ Transaksi Berhasil Diselesaikan!");

            res.json({
                success: true,
                order_code: orderCode,
                payment_info: paymentResult
            });

        } catch (error) {
            // PENTING: Rollback dilakukan SEGERA setelah error terdeteksi
            if (connection) {
                console.log("--- ❌ Melakukan Rollback Transaksi ---");
                await connection.rollback();
            }
            
            // Log Error Detail
            console.error("--- ❌ Order Error Detail ---");
            console.error("Order Code:", orderCode);
            console.error("Message:", error.message);
            if (error.code) console.error("DB Error Code:", error.code);
            
            res.status(500).json({ 
                success: false, 
                message: error.message,
                db_error_code: error.code 
            });
        } finally {
            // PENTING: Selalu lepaskan koneksi ke pool baik sukses maupun gagal
            if (connection) {
                console.log("--- 🔌 Melepas Koneksi Database ---");
                connection.release();
            }
        }
    }
};

module.exports = OrderController;