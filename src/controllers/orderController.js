const db = require('../config/db');
const PaymentController = require('./paymentController');

const OrderController = {
    createOrder: async (req, res) => {
        let connection;
        try {
            const { customer_id, mitra_id, order_info, payment_info } = req.body;
            connection = await db.getConnection();
            await connection.beginTransaction();

            const orderCode = `ORD-${Date.now()}`;
            
            // 1. Simpan ke tabel orders
            const [orderResult] = await connection.query(
                `INSERT INTO orders (order_code, customer_id, mitra_id, total_amount, transport_fee, admin_fee, status, scheduled_at) 
                 VALUES (?, ?, ?, ?, ?, ?, 'pending_payment', ?)`,
                [
                    orderCode, 
                    customer_id, 
                    mitra_id, 
                    order_info.total_bayar, 
                    order_info.rincian_biaya.transport, 
                    order_info.rincian_biaya.admin, 
                    order_info.scheduled_at
                ]
            );

            const orderId = orderResult.insertId;

            // 2. Ambil data customer untuk keperluan Payment Gateway
            const [customerRows] = await connection.query("SELECT name, phone, email FROM users WHERE id = ?", [customer_id]);
            const customer = customerRows[0];

            // 3. Panggil Payment Controller (Orkestrasi)
            const paymentResult = await PaymentController.requestPaymentGateway({
                order_id: orderId,
                order_code: orderCode,
                amount: order_info.total_bayar,
                customer: customer,
                method: payment_info.method_type, // 'VA' atau 'QRIS'
                bank_code: payment_info.method // kode bank jika VA
            });

            await connection.commit();

            res.json({
                success: true,
                order_code: orderCode,
                payment_info: paymentResult
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error("Order Error:", error.message);
            res.status(500).json({ success: false, message: error.message });
        } finally {
            if (connection) connection.release();
        }
    }
};

module.exports = OrderController;