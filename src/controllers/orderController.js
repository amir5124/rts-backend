const db = require('../config/db');
const PaymentController = require('./paymentController');
const notificationService = require('../services/notificationService');

const OrderController = {
    // 1. CREATE ORDER
    createOrder: async (req, res) => {
        let connection;
        const orderCode = `ORD-${Date.now()}`;

        try {
            console.log(`\n--- 🏁 MEMULAI PROSES ORDER: ${orderCode} ---`);

            const {
                customer_id, mitra_id, service_id, location_info,
                latitude_dest, longitude_dest, order_info, payment_info
            } = req.body;

            connection = await db.getConnection();
            console.log("DB: Koneksi didapatkan.");

            await connection.beginTransaction();
            console.log("DB: Transaksi dimulai.");

            const queryInsert = `
                INSERT INTO orders (
                    order_code, customer_id, mitra_id, service_id, duration,
                    total_amount, transport_fee, admin_fee, status, scheduled_at,
                    latitude_dest, longitude_dest, address_google, address_detail, note, payment_method_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            const valuesInsert = [
                orderCode, customer_id, mitra_id, service_id || null,
                order_info.durasi, order_info.total_bayar,
                order_info.rincian_biaya.transport, order_info.rincian_biaya.admin,
                'pending_payment', order_info.scheduled_at,
                latitude_dest, longitude_dest,
                location_info.address_google, location_info.address_detail,
                location_info.note || "", payment_info.method
            ];

            const [orderResult] = await connection.query(queryInsert, valuesInsert);
            const orderId = orderResult.insertId;
            console.log(`DB: Order disimpan (ID: ${orderId}).`);

            // Get customer info for notification
            const [customerRows] = await connection.query(
                "SELECT name, phone, email FROM users WHERE id = ?",
                [customer_id]
            );
            const customer = customerRows[0];

            // Get service info for notification
            const [serviceRows] = await connection.query(
                "SELECT service_name FROM services WHERE id = ?",
                [service_id]
            );
            const serviceName = serviceRows[0]?.service_name || 'Layanan';

            // Get mitra info for notification
            const [mitraRows] = await connection.query(
                "SELECT name FROM users WHERE id = ?",
                [mitra_id]
            );
            const mitraName = mitraRows[0]?.name || 'Mitra';

            if (!customer) throw new Error("Customer tidak ditemukan.");

            console.log("API: Meminta session ke LinkQu...");
            const paymentResult = await PaymentController.requestPaymentGateway({
                order_id: orderId,
                order_code: orderCode,
                amount: order_info.total_bayar,
                customer: customer,
                method: payment_info.method_type,
                bank_code: payment_info.method
            }, connection);

            await connection.commit();
            console.log("DB: Transaksi BERHASIL di-commit.");

            // ========== KIRIM NOTIFIKASI KE MITRA ==========
            try {
                console.log(`📢 Mengirim notifikasi pesanan baru ke mitra ID: ${mitra_id}`);

                const notificationResult = await notificationService.sendNewOrderNotificationToMitra(
                    mitra_id,
                    orderId,
                    customer.name,
                    serviceName,
                    orderCode
                );

                if (notificationResult.success) {
                    console.log(`✅ Notifikasi pesanan baru berhasil dikirim ke mitra (${notificationResult.successCount} device)`);
                } else {
                    console.log(`⚠️ Gagal mengirim notifikasi ke mitra: ${notificationResult.message}`);
                }
            } catch (notifError) {
                console.error('❌ Error sending notification to mitra:', notifError.message);
            }

            // ========== KIRIM NOTIFIKASI KE CUSTOMER ==========
            try {
                console.log(`📢 Mengirim notifikasi pesanan dibuat ke customer ID: ${customer_id}`);

                const formattedAmount = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(order_info.total_bayar);

                const customerNotificationResult = await notificationService.sendOrderCreatedNotificationToCustomer(
                    customer_id,
                    orderId,
                    orderCode,
                    order_info.total_bayar
                );

                if (customerNotificationResult.success) {
                    console.log(`✅ Notifikasi pesanan dibuat berhasil dikirim ke customer`);
                }
            } catch (notifError) {
                console.error('❌ Error sending notification to customer:', notifError.message);
            }

            return res.json({
                success: true,
                order_code: orderCode,
                order_id: orderId,
                payment_info: paymentResult,
                notification_sent: true
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

    // 2. UPDATE ORDER STATUS (UNTUK MITRA & CUSTOMER)
    updateOrderStatus: async (req, res) => {
        let connection;
        const { id } = req.params;
        const { status, reason } = req.body;

        const validStatuses = [
            'pending_payment', 'pending', 'confirmed', 'paid',
            'otw', 'ongoing', 'processing', 'completed', 'cancelled', 'released'
        ];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Status tidak valid. Status yang valid: ' + validStatuses.join(', ')
            });
        }

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // Get order details before update
            const [orderRows] = await connection.query(
                `SELECT o.*, 
                        u.name as customer_name, u.email as customer_email, u.phone as customer_phone,
                        m.name as mitra_name, m.email as mitra_email, m.phone as mitra_phone,
                        s.service_name
                 FROM orders o
                 JOIN users u ON o.customer_id = u.id
                 LEFT JOIN users m ON o.mitra_id = m.id
                 LEFT JOIN services s ON o.service_id = s.id
                 WHERE o.id = ?`,
                [id]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
            }

            const order = orderRows[0];
            const oldStatus = order.status;

            // Update order status
            await connection.query(
                'UPDATE orders SET status = ? WHERE id = ?',
                [status, id]
            );

            // Update timestamps based on status
            if (status === 'confirmed' && oldStatus !== 'confirmed') {
                await connection.query(
                    'UPDATE orders SET confirmed_at_mitra = NOW() WHERE id = ?',
                    [id]
                );
            }

            if (status === 'completed') {
                await connection.query(
                    'UPDATE orders SET completed_at = NOW() WHERE id = ?',
                    [id]
                );
                // Update payment status jika order selesai
                await connection.query(
                    'UPDATE payments SET status = ?, paid_at = NOW() WHERE order_id = ? AND status != "SUCCESS"',
                    ['SUCCESS', id]
                );
            }

            if (status === 'cancelled') {
                await connection.query(
                    'UPDATE payments SET status = ?, updated_at = NOW() WHERE order_id = ?',
                    ['CANCELLED', id]
                );
            }

            await connection.commit();
            console.log(`✅ Order ${id} status updated from ${oldStatus} to ${status}`);

            // ========== KIRIM NOTIFIKASI BERDASARKAN PERUBAHAN STATUS ==========

            // 1. Notifikasi ke customer: pesanan dikonfirmasi oleh mitra
            if (status === 'confirmed' && oldStatus !== 'confirmed') {
                try {
                    await notificationService.sendOrderConfirmedNotificationToCustomer(
                        order.customer_id,
                        id,
                        order.order_code,
                        order.mitra_name || 'Mitra'
                    );
                    console.log(`✅ Confirmation notification sent to customer ${order.customer_id}`);
                } catch (err) {
                    console.error('Error sending confirmation notification:', err.message);
                }
            }

            // 2. Notifikasi ke customer: pesanan sedang diproses
            if (status === 'processing' && oldStatus !== 'processing') {
                try {
                    await notificationService.sendOrderProcessingNotificationToCustomer(
                        order.customer_id,
                        id,
                        order.order_code
                    );
                    console.log(`✅ Processing notification sent to customer ${order.customer_id}`);
                } catch (err) {
                    console.error('Error sending processing notification:', err.message);
                }
            }

            // 3. Notifikasi ke customer: pesanan selesai
            if (status === 'completed' && oldStatus !== 'completed') {
                try {
                    await notificationService.sendOrderCompletedNotificationToCustomer(
                        order.customer_id,
                        id,
                        order.order_code,
                        order.service_name || 'Layanan'
                    );
                    console.log(`✅ Completion notification sent to customer ${order.customer_id}`);
                } catch (err) {
                    console.error('Error sending completion notification:', err.message);
                }
            }

            // 4. Notifikasi ke customer: pesanan dibatalkan
            if (status === 'cancelled' && oldStatus !== 'cancelled') {
                try {
                    await notificationService.sendOrderCancelledNotificationToCustomer(
                        order.customer_id,
                        id,
                        order.order_code,
                        reason || null
                    );
                    console.log(`✅ Cancellation notification sent to customer ${order.customer_id}`);
                } catch (err) {
                    console.error('Error sending cancellation notification:', err.message);
                }
            }

            // 5. Notifikasi ke mitra: pesanan dibatalkan oleh customer
            if (status === 'cancelled' && order.mitra_id) {
                try {
                    const cancelReason = reason || 'Tidak ada alasan';
                    await notificationService.sendOrderCancelledNotification(
                        order.mitra_id,
                        id,
                        order.customer_name,
                        cancelReason
                    );
                    console.log(`✅ Cancellation notification sent to mitra ${order.mitra_id}`);
                } catch (err) {
                    console.error('Error sending cancellation to mitra:', err.message);
                }
            }

            // 6. Notifikasi ke mitra: pesanan selesai
            if (status === 'completed' && order.mitra_id) {
                try {
                    await notificationService.sendOrderCompletedNotification(
                        order.mitra_id,
                        id,
                        order.customer_name
                    );
                    console.log(`✅ Completion notification sent to mitra ${order.mitra_id}`);
                } catch (err) {
                    console.error('Error sending completion to mitra:', err.message);
                }
            }

            return res.json({
                success: true,
                message: `Status order berhasil diubah menjadi ${status}`,
                data: {
                    id: parseInt(id),
                    status: status,
                    old_status: oldStatus
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Error updating order status:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 3. GET ORDERS BY CUSTOMER
    getOrdersByCustomer: async (req, res) => {
        let connection;
        const { customer_id } = req.params;

        const getBankName = (bankCode) => {
            const bankMap = {
                '002': 'BANK BRI', '008': 'BANK MANDIRI', '009': 'BANK BNI',
                '014': 'BANK BCA', '022': 'BANK CIMB NIAGA', 'qris': 'QRIS'
            };
            return bankMap[bankCode] || null;
        };

        try {
            connection = await db.getConnection();

            const query = `
                SELECT 
                    o.id, o.order_code, o.status, o.total_amount, o.scheduled_at,
                    o.service_id, o.duration, o.created_at, o.address_google, o.address_detail,
                    o.latitude_dest, o.longitude_dest, o.mitra_id, o.confirmed_at_mitra,
                    o.confirmed_at_customer, o.note, o.transport_fee, o.admin_fee,
                    s.service_name, s.description as service_description,
                    u.name as mitra_name, u.phone as mitra_phone, u.email as mitra_email, 
                    u.profile_pic as mitra_profile_pic,
                    md.specialization, md.is_verified as mitra_is_verified, 
                    md.is_online as mitra_is_online, md.certificate_url,
                    p.id as payment_id, p.partner_reff, p.external_id, p.method as payment_method,
                    p.bank_code, p.va_number, p.qris_url, p.amount as payment_amount,
                    p.fee_admin_pg, p.status as payment_status, p.expired_at as payment_expiry,
                    p.paid_at, p.created_at as payment_created_at,
                    p.payload_request, p.payload_callback
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

            const formattedOrders = await Promise.all(orders.map(async (order) => {
                let mitraRating = 0;
                if (order.mitra_id) {
                    const [ratingResult] = await connection.query(
                        "SELECT COALESCE(AVG(rating), 0) as avg_rating FROM reviews WHERE mitra_id = ?",
                        [order.mitra_id]
                    );
                    mitraRating = parseFloat(ratingResult[0]?.avg_rating) || 0;
                }

                let servicePrice = 0;
                if (order.service_id && order.duration) {
                    const [priceResult] = await connection.query(
                        "SELECT price FROM service_prices WHERE service_id = ? AND duration = ?",
                        [order.service_id, order.duration]
                    );
                    servicePrice = parseFloat(priceResult[0]?.price) || 0;
                }

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

                    if (order.payment_method === 'VA' && order.va_number) {
                        paymentDetails.virtual_account = {
                            bank_code: order.bank_code,
                            bank_name: getBankName(order.bank_code),
                            va_number: order.va_number
                        };
                    } else if (order.payment_method === 'QR' && order.qris_url) {
                        paymentDetails.qris = { qris_url: order.qris_url };
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
                    transport_fee: parseFloat(order.transport_fee) || 0,
                    admin_fee: parseFloat(order.admin_fee) || 0,
                    service: {
                        id: order.service_id,
                        name: order.service_name,
                        description: order.service_description,
                        price: servicePrice
                    },
                    mitra: order.mitra_id ? {
                        id: order.mitra_id,
                        name: order.mitra_name,
                        phone: order.mitra_phone,
                        email: order.mitra_email,
                        profile_pic: order.mitra_profile_pic,
                        rating: mitraRating,
                        is_verified: Boolean(order.mitra_is_verified),
                        is_online: Boolean(order.mitra_is_online),
                        specialization: order.specialization,
                        certificate_url: order.certificate_url
                    } : null,
                    location: {
                        address: order.address_google,
                        detail: order.address_detail,
                        latitude: order.latitude_dest ? parseFloat(order.latitude_dest) : null,
                        longitude: order.longitude_dest ? parseFloat(order.longitude_dest) : null
                    },
                    confirmations: {
                        mitra_confirmed_at: order.confirmed_at_mitra,
                        customer_confirmed_at: order.confirmed_at_customer
                    },
                    payment: paymentDetails,
                    created_at: order.created_at
                };
            }));

            return res.json({
                success: true,
                code: 200,
                message: "Riwayat pesanan berhasil ditemukan",
                data: { total: formattedOrders.length, orders: formattedOrders }
            });

        } catch (error) {
            console.error(`❌ GAGAL MENGAMBIL DATA ORDER:`, error.message);
            return res.status(500).json({
                success: false,
                code: 500,
                message: "Terjadi kesalahan pada server",
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 4. GET ORDER BY ID
    getOrderById: async (req, res) => {
        let connection;
        const { id } = req.params;

        const getBankName = (bankCode) => {
            const bankMap = {
                '002': 'BANK BRI', '008': 'BANK MANDIRI', '009': 'BANK BNI',
                '014': 'BANK BCA', '022': 'BANK CIMB NIAGA', 'qris': 'QRIS'
            };
            return bankMap[bankCode] || null;
        };

        try {
            connection = await db.getConnection();

            const [orders] = await connection.query(
                `SELECT 
                    o.*,
                    u.name as customer_name, 
                    u.phone as customer_phone, 
                    u.email as customer_email,
                    u.profile_pic as customer_profile_pic,
                    m.name as mitra_name, 
                    m.phone as mitra_phone, 
                    m.email as mitra_email,
                    m.profile_pic as mitra_profile_pic,
                    s.service_name, s.description as service_description,
                    md.specialization, md.is_verified as mitra_is_verified,
                    p.id as payment_id, p.partner_reff, p.external_id, p.method as payment_method,
                    p.bank_code, p.va_number, p.qris_url, p.amount as payment_amount,
                    p.fee_admin_pg, p.status as payment_status, p.expired_at as payment_expiry,
                    p.paid_at, p.created_at as payment_created_at,
                    p.payload_request, p.payload_callback
                FROM orders o
                LEFT JOIN users u ON o.customer_id = u.id
                LEFT JOIN users m ON o.mitra_id = m.id
                LEFT JOIN services s ON o.service_id = s.id
                LEFT JOIN mitra_details md ON m.id = md.user_id
                LEFT JOIN payments p ON o.id = p.order_id
                WHERE o.id = ?`,
                [id]
            );

            if (orders.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Order tidak ditemukan'
                });
            }

            const order = orders[0];

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

                if (order.payment_method === 'VA' && order.va_number) {
                    paymentDetails.virtual_account = {
                        bank_code: order.bank_code,
                        bank_name: getBankName(order.bank_code),
                        va_number: order.va_number
                    };
                } else if (order.payment_method === 'QR' && order.qris_url) {
                    paymentDetails.qris = { qris_url: order.qris_url };
                }
            }

            let mitraRating = 0;
            if (order.mitra_id) {
                const [ratingResult] = await connection.query(
                    "SELECT COALESCE(AVG(rating), 0) as avg_rating FROM reviews WHERE mitra_id = ?",
                    [order.mitra_id]
                );
                mitraRating = parseFloat(ratingResult[0]?.avg_rating) || 0;
            }

            const formattedOrder = {
                id: order.id,
                order_code: order.order_code,
                status: order.status,
                total_amount: parseFloat(order.total_amount),
                transport_fee: parseFloat(order.transport_fee) || 0,
                admin_fee: parseFloat(order.admin_fee) || 0,
                scheduled_at: order.scheduled_at,
                note: order.note,
                duration: order.duration,
                customer: {
                    id: order.customer_id,
                    name: order.customer_name,
                    phone: order.customer_phone,
                    email: order.customer_email,
                    profile_pic: order.customer_profile_pic
                },
                mitra: order.mitra_id ? {
                    id: order.mitra_id,
                    name: order.mitra_name,
                    phone: order.mitra_phone,
                    email: order.mitra_email,
                    profile_pic: order.mitra_profile_pic,
                    rating: mitraRating,
                    is_verified: Boolean(order.mitra_is_verified),
                    specialization: order.specialization
                } : null,
                service: {
                    id: order.service_id,
                    name: order.service_name,
                    description: order.service_description
                },
                location: {
                    address_google: order.address_google,
                    address_detail: order.address_detail,
                    latitude: order.latitude_dest ? parseFloat(order.latitude_dest) : null,
                    longitude: order.longitude_dest ? parseFloat(order.longitude_dest) : null
                },
                payment: paymentDetails,
                confirmed_at_mitra: order.confirmed_at_mitra,
                confirmed_at_customer: order.confirmed_at_customer,
                created_at: order.created_at,
                updated_at: order.updated_at
            };

            return res.json({
                success: true,
                data: formattedOrder
            });

        } catch (error) {
            console.error('Error in getOrderById:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 5. CANCEL ORDER (BY CUSTOMER)
    cancelOrder: async (req, res) => {
        let connection;
        const { id } = req.params;
        const { reason } = req.body;

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const [orderRows] = await connection.query(
                `SELECT o.*, u.name as customer_name, m.name as mitra_name 
                 FROM orders o
                 LEFT JOIN users u ON o.customer_id = u.id
                 LEFT JOIN users m ON o.mitra_id = m.id
                 WHERE o.id = ?`,
                [id]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Order tidak ditemukan'
                });
            }

            const order = orderRows[0];
            const allowedStatus = ['pending_payment', 'pending'];

            if (!allowedStatus.includes(order.status)) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Order dengan status ${order.status} tidak dapat dibatalkan`
                });
            }

            await connection.query(
                'UPDATE orders SET status = ? WHERE id = ?',
                ['cancelled', id]
            );

            await connection.query(
                'UPDATE payments SET status = ? WHERE order_id = ?',
                ['CANCELLED', id]
            );

            await connection.commit();

            // Kirim notifikasi ke mitra jika ada
            if (order.mitra_id) {
                try {
                    await notificationService.sendOrderCancelledNotification(
                        order.mitra_id,
                        id,
                        order.customer_name,
                        reason || 'Dibatalkan oleh customer'
                    );
                    console.log(`✅ Cancellation notification sent to mitra ${order.mitra_id}`);
                } catch (err) {
                    console.error('Error sending cancellation to mitra:', err.message);
                }
            }

            return res.json({
                success: true,
                message: 'Order berhasil dibatalkan'
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Error in cancelOrder:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 6. GET ALL ORDERS (ADMIN ONLY)
    getAllOrders: async (req, res) => {
        let connection;
        const { page = 1, limit = 10, status } = req.query;
        const offset = (page - 1) * limit;

        try {
            connection = await db.getConnection();

            let countQuery = `SELECT COUNT(*) as total FROM orders o`;
            let dataQuery = `
                SELECT 
                    o.id, o.order_code, o.status, o.total_amount, o.created_at, o.scheduled_at,
                    u.name as customer_name, u.email as customer_email, u.phone as customer_phone,
                    m.name as mitra_name, m.email as mitra_email, m.phone as mitra_phone,
                    p.id as payment_id, p.method as payment_method, p.status as payment_status,
                    p.amount as payment_amount, p.paid_at
                FROM orders o
                LEFT JOIN users u ON o.customer_id = u.id
                LEFT JOIN users m ON o.mitra_id = m.id
                LEFT JOIN payments p ON o.id = p.order_id
            `;

            const queryParams = [];

            if (status && status !== 'all') {
                countQuery += ` WHERE o.status = ?`;
                dataQuery += ` WHERE o.status = ?`;
                queryParams.push(status);
            }

            const [countResult] = await connection.query(countQuery, queryParams);
            const total = countResult[0].total;

            dataQuery += ` ORDER BY o.created_at DESC LIMIT ? OFFSET ?`;
            queryParams.push(parseInt(limit), offset);

            const [orders] = await connection.query(dataQuery, queryParams);

            return res.json({
                success: true,
                data: {
                    orders: orders,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total: total,
                        total_pages: Math.ceil(total / limit)
                    }
                }
            });
        } catch (error) {
            console.error('Error in getAllOrders:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 7. GET ORDER STATISTICS (ADMIN ONLY)
    getOrderStatistics: async (req, res) => {
        let connection;

        try {
            connection = await db.getConnection();

            const [overview] = await connection.query(`
                SELECT 
                    COUNT(DISTINCT o.id) as total_orders,
                    COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) as total_revenue,
                    COALESCE(AVG(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE NULL END), 0) as avg_order_value,
                    COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' THEN p.amount ELSE 0 END), 0) as total_payment_success,
                    COALESCE(SUM(CASE WHEN p.status = 'PENDING' THEN p.amount ELSE 0 END), 0) as total_payment_pending
                FROM orders o
                LEFT JOIN payments p ON o.id = p.order_id
            `);

            const [byStatus] = await connection.query(`
                SELECT 
                    o.status,
                    COUNT(*) as total,
                    COALESCE(SUM(o.total_amount), 0) as total_amount
                FROM orders o
                GROUP BY o.status
                ORDER BY total DESC
            `);

            const [byPaymentStatus] = await connection.query(`
                SELECT 
                    p.status,
                    COUNT(*) as total,
                    COALESCE(SUM(p.amount), 0) as total_amount
                FROM payments p
                GROUP BY p.status
                ORDER BY total DESC
            `);

            const [monthly] = await connection.query(`
                SELECT 
                    DATE_FORMAT(o.created_at, '%Y-%m') as month,
                    COUNT(DISTINCT o.id) as total_orders,
                    COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) as total_revenue,
                    SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
                    COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' THEN p.amount ELSE 0 END), 0) as payment_success
                FROM orders o
                LEFT JOIN payments p ON o.id = p.order_id
                WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
                GROUP BY DATE_FORMAT(o.created_at, '%Y-%m')
                ORDER BY month DESC
            `);

            return res.json({
                success: true,
                data: {
                    overview: overview[0],
                    by_status: byStatus,
                    by_payment_status: byPaymentStatus,
                    monthly: monthly
                }
            });
        } catch (error) {
            console.error('Error in getOrderStatistics:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 8. GET ORDERS BY MITRA
    getOrdersByMitra: async (req, res) => {
        let connection;
        const { mitra_id } = req.params;

        try {
            connection = await db.getConnection();

            const query = `
                SELECT 
                    o.id, o.order_code, o.status, o.total_amount, o.scheduled_at,
                    o.service_id, o.duration, o.created_at, o.address_google, o.address_detail,
                    o.latitude_dest, o.longitude_dest, o.customer_id, o.confirmed_at_mitra,
                    o.confirmed_at_customer, o.note, o.transport_fee, o.admin_fee,
                    s.service_name, s.description as service_description,
                    u.name as customer_name, u.phone as customer_phone, u.email as customer_email,
                    u.profile_pic as customer_profile_pic,
                    p.id as payment_id, p.partner_reff, p.external_id, p.method as payment_method,
                    p.bank_code, p.va_number, p.qris_url, p.amount as payment_amount,
                    p.fee_admin_pg, p.status as payment_status, p.expired_at as payment_expiry,
                    p.paid_at, p.created_at as payment_created_at
                FROM orders o
                LEFT JOIN services s ON o.service_id = s.id
                LEFT JOIN users u ON o.customer_id = u.id
                LEFT JOIN payments p ON o.id = p.order_id
                WHERE o.mitra_id = ?
                ORDER BY o.created_at DESC
            `;

            const [orders] = await connection.query(query, [mitra_id]);

            const formattedOrders = orders.map(order => {
                let paymentDetails = null;
                if (order.payment_id) {
                    paymentDetails = {
                        id: order.payment_id,
                        partner_reff: order.partner_reff,
                        external_id: order.external_id,
                        method: order.payment_method,
                        status: order.payment_status,
                        amount: parseFloat(order.payment_amount) || parseFloat(order.total_amount),
                        expired_at: order.payment_expiry,
                        paid_at: order.paid_at
                    };
                }

                return {
                    id: order.id,
                    order_code: order.order_code,
                    status: order.status,
                    total_amount: parseFloat(order.total_amount),
                    scheduled_at: order.scheduled_at,
                    duration: order.duration,
                    customer: {
                        id: order.customer_id,
                        name: order.customer_name,
                        phone: order.customer_phone,
                        email: order.customer_email,
                        profile_pic: order.customer_profile_pic
                    },
                    service: {
                        id: order.service_id,
                        name: order.service_name
                    },
                    location: {
                        address: order.address_google,
                        detail: order.address_detail
                    },
                    payment: paymentDetails,
                    created_at: order.created_at
                };
            });

            return res.json({
                success: true,
                data: {
                    total: formattedOrders.length,
                    orders: formattedOrders
                }
            });

        } catch (error) {
            console.error('Error in getOrdersByMitra:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 9. UPDATE ORDER STATUS (ADMIN ONLY) - Legacy/Alternative
    updateOrderStatusAdmin: async (req, res) => {
        let connection;
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = [
            'pending_payment', 'pending', 'paid', 'otw',
            'ongoing', 'completed', 'cancelled', 'released'
        ];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Status tidak valid. Status yang valid: ' + validStatuses.join(', ')
            });
        }

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const [order] = await connection.query(
                'SELECT status FROM orders WHERE id = ?',
                [id]
            );

            if (order.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Order tidak ditemukan'
                });
            }

            await connection.query(
                'UPDATE orders SET status = ? WHERE id = ?',
                [status, id]
            );

            if (status === 'completed') {
                await connection.query(
                    'UPDATE payments SET status = ? WHERE order_id = ? AND status != "SUCCESS"',
                    ['SUCCESS', id]
                );
            }

            await connection.commit();

            return res.json({
                success: true,
                message: `Status order berhasil diubah menjadi ${status}`,
                data: { id: parseInt(id), status: status }
            });
        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Error in updateOrderStatusAdmin:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // ========== ENDPOINT UNTUK MITRA (ORDER MANAGEMENT) ==========

    // 9. GET ORDER DETAIL FOR MITRA
    getOrderDetailForMitra: async (req, res) => {
        let connection;
        const { id } = req.params;
        const mitraId = req.user?.id; // Ambil dari auth middleware

        try {
            connection = await db.getConnection();

            const [orders] = await connection.query(
                `SELECT 
                o.*,
                u.name as customer_name, 
                u.phone as customer_phone, 
                u.email as customer_email,
                u.profile_pic as customer_profile_pic,
                s.service_name, s.description as service_description, s.base_price,
                p.id as payment_id, p.method as payment_method, 
                p.status as payment_status, p.amount as payment_amount
            FROM orders o
            LEFT JOIN users u ON o.customer_id = u.id
            LEFT JOIN services s ON o.service_id = s.id
            LEFT JOIN payments p ON o.id = p.order_id
            WHERE o.id = ? AND o.mitra_id = ?`,
                [id, mitraId]
            );

            if (orders.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Order tidak ditemukan atau bukan milik mitra ini'
                });
            }

            const order = orders[0];

            const formattedOrder = {
                id: order.id,
                order_code: order.order_code,
                status: order.status,
                total_amount: parseFloat(order.total_amount),
                transport_fee: parseFloat(order.transport_fee) || 0,
                admin_fee: parseFloat(order.admin_fee) || 0,
                scheduled_at: order.scheduled_at,
                note: order.note,
                duration: order.duration,
                customer: {
                    id: order.customer_id,
                    name: order.customer_name,
                    phone: order.customer_phone,
                    email: order.customer_email,
                    profile_pic: order.customer_profile_pic
                },
                service: {
                    id: order.service_id,
                    name: order.service_name,
                    description: order.service_description,
                    base_price: parseFloat(order.base_price) || 0
                },
                location: {
                    address_google: order.address_google,
                    address_detail: order.address_detail,
                    latitude: order.latitude_dest ? parseFloat(order.latitude_dest) : null,
                    longitude: order.longitude_dest ? parseFloat(order.longitude_dest) : null
                },
                payment: order.payment_id ? {
                    id: order.payment_id,
                    method: order.payment_method,
                    status: order.payment_status,
                    amount: parseFloat(order.payment_amount) || parseFloat(order.total_amount)
                } : null,
                created_at: order.created_at
            };

            return res.json({
                success: true,
                data: { order: formattedOrder }
            });

        } catch (error) {
            console.error('Error in getOrderDetailForMitra:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 10. MITRA ACCEPT ORDER
    acceptOrder: async (req, res) => {
        let connection;
        const { id } = req.params;
        const mitraId = req.user?.id;

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // Cek apakah order exists dan milik mitra ini
            const [orderRows] = await connection.query(
                `SELECT o.*, u.name as customer_name, s.service_name 
             FROM orders o
             LEFT JOIN users u ON o.customer_id = u.id
             LEFT JOIN services s ON o.service_id = s.id
             WHERE o.id = ? AND o.mitra_id = ?`,
                [id, mitraId]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Order tidak ditemukan atau bukan milik mitra ini'
                });
            }

            const order = orderRows[0];

            // Validasi status
            const allowedStatuses = ['paid', 'pending_payment'];
            if (!allowedStatuses.includes(order.status)) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Pesanan dengan status ${order.status} tidak dapat diterima`
                });
            }

            // Update status order
            await connection.query(
                'UPDATE orders SET status = ?, confirmed_at_mitra = NOW() WHERE id = ?',
                ['accepted', id]
            );

            await connection.commit();

            // Kirim notifikasi ke customer
            try {
                const notificationService = require('../services/notificationService');
                await notificationService.sendOrderConfirmedNotificationToCustomer(
                    order.customer_id,
                    id,
                    order.order_code,
                    req.user?.name || 'Mitra'
                );
            } catch (err) {
                console.error('Error sending notification:', err.message);
            }

            return res.json({
                success: true,
                message: 'Pesanan berhasil diterima',
                data: {
                    order_id: parseInt(id),
                    status: 'accepted'
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Error in acceptOrder:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 11. MITRA REJECT ORDER
    rejectOrder: async (req, res) => {
        let connection;
        const { id } = req.params;
        const mitraId = req.user?.id;
        const { reason } = req.body;

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const [orderRows] = await connection.query(
                `SELECT o.*, u.name as customer_name 
             FROM orders o
             WHERE o.id = ? AND o.mitra_id = ?`,
                [id, mitraId]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Order tidak ditemukan atau bukan milik mitra ini'
                });
            }

            const order = orderRows[0];
            const allowedStatuses = ['paid', 'pending_payment'];

            if (!allowedStatuses.includes(order.status)) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Pesanan dengan status ${order.status} tidak dapat ditolak`
                });
            }

            // Update status order
            await connection.query(
                'UPDATE orders SET status = ? WHERE id = ?',
                ['cancelled', id]
            );

            // Update payment status
            await connection.query(
                'UPDATE payments SET status = ? WHERE order_id = ?',
                ['REFUNDED', id]
            );

            await connection.commit();

            // Kirim notifikasi ke customer
            try {
                const notificationService = require('../services/notificationService');
                await notificationService.sendOrderCancelledNotificationToCustomer(
                    order.customer_id,
                    id,
                    order.order_code,
                    reason || 'Ditolak oleh mitra'
                );
            } catch (err) {
                console.error('Error sending notification:', err.message);
            }

            return res.json({
                success: true,
                message: 'Pesanan berhasil ditolak',
                data: {
                    order_id: parseInt(id),
                    status: 'cancelled'
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Error in rejectOrder:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 12. MITRA START ORDER
    startOrder: async (req, res) => {
        let connection;
        const { id } = req.params;
        const mitraId = req.user?.id;

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const [orderRows] = await connection.query(
                `SELECT o.*, u.name as customer_name 
             FROM orders o
             WHERE o.id = ? AND o.mitra_id = ?`,
                [id, mitraId]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Order tidak ditemukan atau bukan milik mitra ini'
                });
            }

            const order = orderRows[0];

            // Validasi status
            if (order.status !== 'accepted') {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Pesanan dengan status ${order.status} tidak dapat dimulai`
                });
            }

            // Update status order
            await connection.query(
                'UPDATE orders SET status = ? WHERE id = ?',
                ['ongoing', id]
            );

            await connection.commit();

            // Kirim notifikasi ke customer
            try {
                const notificationService = require('../services/notificationService');
                await notificationService.sendOrderProcessingNotificationToCustomer(
                    order.customer_id,
                    id,
                    order.order_code
                );
            } catch (err) {
                console.error('Error sending notification:', err.message);
            }

            return res.json({
                success: true,
                message: 'Pekerjaan dimulai',
                data: {
                    order_id: parseInt(id),
                    status: 'ongoing'
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Error in startOrder:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 13. MITRA COMPLETE ORDER
    completeOrder: async (req, res) => {
        let connection;
        const { id } = req.params;
        const mitraId = req.user?.id;

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const [orderRows] = await connection.query(
                `SELECT o.*, u.name as customer_name, s.service_name 
             FROM orders o
             LEFT JOIN users u ON o.customer_id = u.id
             LEFT JOIN services s ON o.service_id = s.id
             WHERE o.id = ? AND o.mitra_id = ?`,
                [id, mitraId]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Order tidak ditemukan atau bukan milik mitra ini'
                });
            }

            const order = orderRows[0];

            // Validasi status
            if (order.status !== 'ongoing' && order.status !== 'accepted') {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Pesanan dengan status ${order.status} tidak dapat diselesaikan`
                });
            }

            // Update status order
            await connection.query(
                'UPDATE orders SET status = ?, completed_at = NOW() WHERE id = ?',
                ['completed', id]
            );

            // Update payment status
            await connection.query(
                'UPDATE payments SET status = ? WHERE order_id = ?',
                ['SUCCESS', id]
            );

            await connection.commit();

            // Kirim notifikasi ke customer
            try {
                const notificationService = require('../services/notificationService');
                await notificationService.sendOrderCompletedNotificationToCustomer(
                    order.customer_id,
                    id,
                    order.order_code,
                    order.service_name
                );
            } catch (err) {
                console.error('Error sending notification:', err.message);
            }

            // TODO: Tambahkan ke wallet mitra (opsional)
            // await addToMitraWallet(mitraId, order.total_amount);

            return res.json({
                success: true,
                message: 'Pesanan berhasil diselesaikan',
                data: {
                    order_id: parseInt(id),
                    status: 'completed'
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Error in completeOrder:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    }

};

module.exports = OrderController;