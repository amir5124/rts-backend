// controllers/orderController.js
const db = require('../config/db');
const moment = require('moment-timezone');
const PaymentController = require('./paymentController');
const notificationService = require('../services/notificationService');
const walletService = require('../services/walletService');
const EscrowService = require('../services/escrowService');

const OrderController = {
    // ========================================================================
    // 1. CREATE ORDER
    // ========================================================================
    createOrder: async (req, res) => {
        let connection;
        const timestamp = Date.now();
        const orderCode = `ORD-${timestamp}`;
        const partnerReff = `PAY-${timestamp}`;

        try {
            console.log(`\n--- 🏁 MEMULAI PROSES ORDER: ${orderCode} ---`);
            console.log(`📝 Partner Reff: ${partnerReff}`);

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
            console.log(`DB: Order disimpan (ID: ${orderId})`);

            // Get customer info for payment gateway
            const [customerRows] = await connection.query(
                "SELECT name, phone, email FROM users WHERE id = ?",
                [customer_id]
            );
            const customer = customerRows[0];

            if (!customer) throw new Error("Customer tidak ditemukan.");

            console.log("API: Meminta session ke LinkQu...");
            const paymentResult = await PaymentController.requestPaymentGateway({
                order_id: orderId,
                order_code: orderCode,
                partner_reff: partnerReff,
                amount: order_info.total_bayar,
                customer: customer,
                method: payment_info.method_type,
                bank_code: payment_info.method
            }, connection);

            await connection.commit();
            console.log("DB: Transaksi BERHASIL di-commit.");

            return res.json({
                success: true,
                order_code: orderCode,
                order_id: orderId,
                partner_reff: partnerReff,
                payment_info: paymentResult,
                notification_sent: false
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

    // ========================================================================
    // 2. UPDATE ORDER STATUS (GENERAL)
    // ========================================================================
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

            // ========== KIRIM NOTIFIKASI ==========
            await OrderController._sendStatusNotifications(order, status, oldStatus, reason);

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

    // ========================================================================
    // 3. PRIVATE: SEND STATUS NOTIFICATIONS
    // ========================================================================
    _sendStatusNotifications: async (order, newStatus, oldStatus, reason = null) => {
        console.log(`📨 [NOTIF] Sending notifications for order ${order.id}: ${oldStatus} → ${newStatus}`);

        try {
            // 1️⃣ NOTIFIKASI: Order Dikonfirmasi oleh Mitra → Customer
            if (newStatus === 'confirmed' && oldStatus !== 'confirmed') {
                await notificationService.sendOrderConfirmedNotificationToCustomer(
                    order.customer_id,
                    order.id,
                    order.order_code,
                    order.mitra_name || 'Mitra'
                );
                console.log(`✅ [NOTIF] Confirmation sent to customer ${order.customer_id}`);
            }

            // 2️⃣ NOTIFIKASI: Order Diproses → Customer
            if (newStatus === 'processing' && oldStatus !== 'processing') {
                await notificationService.sendOrderProcessingNotificationToCustomer(
                    order.customer_id,
                    order.id,
                    order.order_code
                );
                console.log(`✅ [NOTIF] Processing sent to customer ${order.customer_id}`);
            }

            // 3️⃣ NOTIFIKASI: Order Selesai → Customer & Mitra
            if (newStatus === 'completed' && oldStatus !== 'completed') {
                // Ke Customer
                await notificationService.sendOrderCompletedNotificationToCustomer(
                    order.customer_id,
                    order.id,
                    order.order_code,
                    order.service_name || 'Layanan'
                );
                console.log(`✅ [NOTIF] Completion sent to customer ${order.customer_id}`);

                // Ke Mitra
                if (order.mitra_id) {
                    await notificationService.sendOrderCompletedNotification(
                        order.mitra_id,
                        order.id,
                        order.customer_name
                    );
                    console.log(`✅ [NOTIF] Completion sent to mitra ${order.mitra_id}`);
                }
            }

            // 4️⃣ NOTIFIKASI: Order Dibatalkan → Customer & Mitra
            if (newStatus === 'cancelled' && oldStatus !== 'cancelled') {
                // Ke Customer
                await notificationService.sendOrderCancelledNotificationToCustomer(
                    order.customer_id,
                    order.id,
                    order.order_code,
                    reason || 'Pesanan dibatalkan'
                );
                console.log(`✅ [NOTIF] Cancellation sent to customer ${order.customer_id}`);

                // Ke Mitra (jika ada)
                if (order.mitra_id) {
                    await notificationService.sendOrderCancelledNotification(
                        order.mitra_id,
                        order.id,
                        order.customer_name,
                        reason || 'Dibatalkan oleh customer'
                    );
                    console.log(`✅ [NOTIF] Cancellation sent to mitra ${order.mitra_id}`);
                }
            }

            // 5️⃣ NOTIFIKASI: Mitra OTW → Customer
            if (newStatus === 'otw' && oldStatus !== 'otw') {
                await notificationService.sendOrderOtwNotificationToCustomer(
                    order.customer_id,
                    order.id,
                    order.order_code,
                    order.mitra_name || 'Mitra'
                );
                console.log(`✅ [NOTIF] OTW sent to customer ${order.customer_id}`);
            }

            // 6️⃣ NOTIFIKASI: Mitra Mulai Pekerjaan → Customer
            if (newStatus === 'ongoing' && oldStatus !== 'ongoing') {
                await notificationService.sendOrderOngoingNotificationToCustomer(
                    order.customer_id,
                    order.id,
                    order.order_code,
                    order.mitra_name || 'Mitra'
                );
                console.log(`✅ [NOTIF] Ongoing sent to customer ${order.customer_id}`);
            }

        } catch (err) {
            console.error('❌ [NOTIF] Error sending notifications:', err.message);
            // Jangan throw error, notifikasi gagal tidak mengganggu proses utama
        }
    },

    // ========================================================================
    // 4. GET ORDERS BY CUSTOMER
    // ========================================================================
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
                    o.release_status, o.escrow_amount, o.mitra_completed_at, o.auto_release_scheduled_at,
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

                // 🔥 Tambahkan info release status
                let releaseInfo = null;
                if (order.status === 'completed' && order.release_status) {
                    const now = moment.tz('Asia/Jakarta');
                    const completedAt = moment(order.mitra_completed_at);
                    const hoursElapsed = now.diff(completedAt, 'hours');
                    const hoursRemaining = Math.max(0, 24 - hoursElapsed);

                    releaseInfo = {
                        release_status: order.release_status,
                        escrow_amount: parseFloat(order.escrow_amount) || 0,
                        mitra_completed_at: order.mitra_completed_at,
                        auto_release_scheduled_at: order.auto_release_scheduled_at,
                        hours_elapsed: hoursElapsed,
                        hours_remaining: hoursRemaining,
                        can_confirm: order.release_status === 'pending' && hoursElapsed < 24
                    };
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
                    release_info: releaseInfo,
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

    // ========================================================================
    // 5. GET ORDER BY ID
    // ========================================================================
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

            // 🔥 Tambahkan release info
            let releaseInfo = null;
            if (order.status === 'completed' && order.release_status) {
                const now = moment.tz('Asia/Jakarta');
                const completedAt = moment(order.mitra_completed_at);
                const hoursElapsed = now.diff(completedAt, 'hours');
                const hoursRemaining = Math.max(0, 24 - hoursElapsed);

                releaseInfo = {
                    release_status: order.release_status,
                    escrow_amount: parseFloat(order.escrow_amount) || 0,
                    mitra_completed_at: order.mitra_completed_at,
                    auto_release_scheduled_at: order.auto_release_scheduled_at,
                    escrow_released_at: order.escrow_released_at,
                    customer_confirmed_at: order.customer_confirmed_at,
                    hours_elapsed: hoursElapsed,
                    hours_remaining: hoursRemaining,
                    can_confirm: order.release_status === 'pending' && hoursElapsed < 24
                };
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
                release_info: releaseInfo,
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

    // ========================================================================
    // 6. CANCEL ORDER (BY CUSTOMER)
    // ========================================================================
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

            // 🔥 KIRIM NOTIFIKASI
            try {
                // Ke Customer
                await notificationService.sendOrderCancelledNotificationToCustomer(
                    order.customer_id,
                    id,
                    order.order_code,
                    reason || 'Pesanan dibatalkan'
                );
                console.log(`✅ [NOTIF] Cancellation sent to customer ${order.customer_id}`);

                // Ke Mitra (jika ada)
                if (order.mitra_id) {
                    await notificationService.sendOrderCancelledNotification(
                        order.mitra_id,
                        id,
                        order.customer_name,
                        reason || 'Dibatalkan oleh customer'
                    );
                    console.log(`✅ [NOTIF] Cancellation sent to mitra ${order.mitra_id}`);
                }
            } catch (err) {
                console.error('❌ [NOTIF] Error sending cancellation notification:', err.message);
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

    // ========================================================================
    // 7. GET ALL ORDERS (ADMIN)
    // ========================================================================
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
                    o.release_status, o.escrow_amount,
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

    // ========================================================================
    // 8. GET ORDER STATISTICS (ADMIN)
    // ========================================================================
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
                    COALESCE(SUM(CASE WHEN p.status = 'PENDING' THEN p.amount ELSE 0 END), 0) as total_payment_pending,
                    COALESCE(SUM(o.escrow_amount), 0) as total_escrow,
                    COALESCE(SUM(CASE WHEN o.release_status = 'pending' THEN o.escrow_amount ELSE 0 END), 0) as total_escrow_pending,
                    COALESCE(SUM(CASE WHEN o.release_status = 'customer_confirmed' THEN o.escrow_amount ELSE 0 END), 0) as total_escrow_confirmed,
                    COALESCE(SUM(CASE WHEN o.release_status = 'auto_released' THEN o.escrow_amount ELSE 0 END), 0) as total_escrow_auto_released
                FROM orders o
                LEFT JOIN payments p ON o.id = p.order_id
            `);

            const [byStatus] = await connection.query(`
                SELECT 
                    o.status,
                    COUNT(*) as total,
                    COALESCE(SUM(o.total_amount), 0) as total_amount,
                    COALESCE(SUM(o.escrow_amount), 0) as total_escrow
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

            const [byReleaseStatus] = await connection.query(`
                SELECT 
                    o.release_status,
                    COUNT(*) as total,
                    COALESCE(SUM(o.escrow_amount), 0) as total_escrow
                FROM orders o
                WHERE o.status = 'completed'
                GROUP BY o.release_status
            `);

            const [monthly] = await connection.query(`
                SELECT 
                    DATE_FORMAT(o.created_at, '%Y-%m') as month,
                    COUNT(DISTINCT o.id) as total_orders,
                    COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) as total_revenue,
                    SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
                    COALESCE(SUM(CASE WHEN p.status = 'SUCCESS' THEN p.amount ELSE 0 END), 0) as payment_success,
                    COALESCE(SUM(o.escrow_amount), 0) as total_escrow
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
                    by_release_status: byReleaseStatus,
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

    // ========================================================================
    // 9. GET ORDERS BY MITRA
    // ========================================================================
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
                    o.release_status, o.escrow_amount, o.mitra_completed_at, o.auto_release_scheduled_at,
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

                // 🔥 Tambahkan release info
                let releaseInfo = null;
                if (order.status === 'completed' && order.release_status) {
                    const now = moment.tz('Asia/Jakarta');
                    const completedAt = moment(order.mitra_completed_at);
                    const hoursElapsed = now.diff(completedAt, 'hours');
                    const hoursRemaining = Math.max(0, 24 - hoursElapsed);

                    releaseInfo = {
                        release_status: order.release_status,
                        escrow_amount: parseFloat(order.escrow_amount) || 0,
                        mitra_completed_at: order.mitra_completed_at,
                        auto_release_scheduled_at: order.auto_release_scheduled_at,
                        hours_elapsed: hoursElapsed,
                        hours_remaining: hoursRemaining
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
                    release_info: releaseInfo,
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

    // ========================================================================
    // 10. GET ORDER DETAIL FOR MITRA
    // ========================================================================
    getOrderDetailForMitra: async (req, res) => {
        let connection;
        const { id } = req.params;
        const mitra_id = req.user?.id;

        console.log(`🔍 [ORDER] getOrderDetailForMitra called`);
        console.log(`📝 [ORDER] params.id = ${id}, type = ${typeof id}`);
        console.log(`👤 [ORDER] req.user.id = ${mitra_id}`);

        try {
            connection = await db.getConnection();

            const [orders] = await connection.query(
                `SELECT 
                    o.id, o.order_code, o.status, o.total_amount, 
                    o.scheduled_at, o.note, o.created_at,
                    o.latitude_dest, o.longitude_dest, o.address_google, o.address_detail,
                    o.release_status, o.escrow_amount, o.mitra_completed_at,
                    u.id as customer_id, u.name as customer_name, 
                    u.phone as customer_phone, u.email as customer_email,
                    u.profile_pic as customer_profile_pic,
                    s.id as service_id, s.service_name, s.description as service_description,
                    COALESCE(sp.price, 0) as base_price,
                    p.id as payment_id, p.method as payment_method, 
                    p.status as payment_status, p.amount as payment_amount,
                    p.va_number, p.qris_url
                FROM orders o
                LEFT JOIN users u ON o.customer_id = u.id
                LEFT JOIN services s ON o.service_id = s.id
                LEFT JOIN service_prices sp ON s.id = sp.service_id AND sp.duration = o.duration
                LEFT JOIN payments p ON o.id = p.order_id
                WHERE o.id = ?`,
                [id]
            );

            if (orders.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Pesanan tidak ditemukan'
                });
            }

            const order = orders[0];

            if (order.mitra_id && order.mitra_id !== mitra_id) {
                return res.status(403).json({
                    success: false,
                    message: 'Akses ditolak. Pesanan bukan milik Anda.'
                });
            }

            // 🔥 Release info untuk mitra
            let releaseInfo = null;
            if (order.status === 'completed' && order.release_status) {
                const now = moment.tz('Asia/Jakarta');
                const completedAt = moment(order.mitra_completed_at);
                const hoursElapsed = now.diff(completedAt, 'hours');
                const hoursRemaining = Math.max(0, 24 - hoursElapsed);

                releaseInfo = {
                    release_status: order.release_status,
                    escrow_amount: parseFloat(order.escrow_amount) || 0,
                    mitra_completed_at: order.mitra_completed_at,
                    hours_elapsed: hoursElapsed,
                    hours_remaining: hoursRemaining,
                    is_released: order.release_status !== 'pending'
                };
            }

            const response = {
                id: order.id,
                order_code: order.order_code,
                status: order.status,
                total_amount: parseFloat(order.total_amount),
                scheduled_at: order.scheduled_at,
                note: order.note,
                customer: {
                    id: order.customer_id,
                    name: order.customer_name || 'Pelanggan',
                    phone: order.customer_phone || '-',
                    email: order.customer_email || '-',
                    profile_pic: order.customer_profile_pic
                },
                service: {
                    id: order.service_id,
                    name: order.service_name || 'Layanan',
                    description: order.service_description || '',
                    base_price: parseFloat(order.base_price) || 0
                },
                location: {
                    address: order.address_google || 'Alamat tidak tersedia',
                    detail: order.address_detail || '',
                    latitude: order.latitude_dest ? parseFloat(order.latitude_dest) : null,
                    longitude: order.longitude_dest ? parseFloat(order.longitude_dest) : null
                },
                payment: order.payment_id ? {
                    id: order.payment_id,
                    method: order.payment_method,
                    status: order.payment_status,
                    amount: parseFloat(order.payment_amount) || parseFloat(order.total_amount),
                    va_number: order.va_number,
                    qris_url: order.qris_url
                } : null,
                release_info: releaseInfo,
                created_at: order.created_at
            };

            res.json({
                success: true,
                data: { order: response }
            });

        } catch (error) {
            console.error('❌ Error in getOrderDetailForMitra:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // ========================================================================
    // 11. MITRA ACCEPT ORDER
    // ========================================================================
    acceptOrder: async (req, res) => {
        let connection;
        const { id } = req.params;
        const mitraId = req.user?.id;

        console.log(`\n========== [ACCEPT ORDER] ==========`);
        console.log(`📝 Request params.id: ${id}`);
        console.log(`👤 Mitra ID from token: ${mitraId}`);

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
            console.log(`✅ Current order status: ${order.status}`);

            if (order.status === 'pending') {
                await connection.commit();
                console.log(`ℹ️ Order already accepted (status: pending)`);
                return res.json({
                    success: true,
                    message: 'Pesanan sudah diterima sebelumnya',
                    data: { order_id: parseInt(id), status: 'pending', already_accepted: true }
                });
            }

            const allowedStatuses = ['paid', 'pending_payment'];
            if (!allowedStatuses.includes(order.status)) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Pesanan dengan status ${order.status} tidak dapat diterima`
                });
            }

            await connection.query(
                'UPDATE orders SET status = ?, confirmed_at_mitra = NOW() WHERE id = ?',
                ['pending', id]
            );

            await connection.commit();
            console.log(`✅ Order ${id} status updated from ${order.status} to 'pending'`);

            // 🔥 NOTIFIKASI: Order diterima mitra → Customer
            try {
                await notificationService.sendOrderConfirmedNotificationToCustomer(
                    order.customer_id,
                    id,
                    order.order_code,
                    req.user?.name || 'Mitra'
                );
                console.log(`✅ [NOTIF] Confirmation sent to customer ${order.customer_id}`);
            } catch (err) {
                console.error('❌ [NOTIF] Error sending notification:', err.message);
            }

            return res.json({
                success: true,
                message: 'Pesanan berhasil diterima',
                data: { order_id: parseInt(id), status: 'pending' }
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

    // ========================================================================
    // 12. MITRA REJECT ORDER
    // ========================================================================
    rejectOrder: async (req, res) => {
        let connection;
        const { id } = req.params;
        const mitraId = req.user?.id;
        const { reason } = req.body;

        console.log(`\n========== [REJECT ORDER] ==========`);
        console.log(`📝 Request params.id: ${id}`);
        console.log(`👤 Mitra ID from token: ${mitraId}`);
        console.log(`💬 Reject reason: ${reason || 'No reason provided'}`);

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const [orderRows] = await connection.query(
                `SELECT o.*, u.name as customer_name 
                 FROM orders o
                 LEFT JOIN users u ON o.customer_id = u.id
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

            await connection.query(
                'UPDATE orders SET status = ? WHERE id = ?',
                ['cancelled', id]
            );

            await connection.query(
                'UPDATE payments SET status = ? WHERE order_id = ?',
                ['REFUNDED', id]
            );

            await connection.commit();
            console.log(`✅ Order ${id} rejected and marked as cancelled`);

            // 🔥 NOTIFIKASI: Order ditolak mitra → Customer
            try {
                await notificationService.sendOrderCancelledNotificationToCustomer(
                    order.customer_id,
                    id,
                    order.order_code,
                    reason || 'Ditolak oleh mitra'
                );
                console.log(`✅ [NOTIF] Rejection sent to customer ${order.customer_id}`);
            } catch (err) {
                console.error('❌ [NOTIF] Error sending notification:', err.message);
            }

            return res.json({
                success: true,
                message: 'Pesanan berhasil ditolak',
                data: { order_id: parseInt(id), status: 'cancelled' }
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

    // ========================================================================
    // 13. MITRA OTW (ON THE WAY)
    // ========================================================================
    otwOrder: async (req, res) => {
        let connection;
        const { id } = req.params;
        const mitraId = req.user?.id;

        console.log(`\n========== [OTW ORDER] ==========`);
        console.log(`📝 Request params.id: ${id}`);
        console.log(`👤 Mitra ID: ${mitraId}`);

        if (!mitraId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized: Mitra ID tidak ditemukan'
            });
        }

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const [orderRows] = await connection.query(
                `SELECT o.*, u.name as customer_name, m.name as mitra_name
                 FROM orders o
                 LEFT JOIN users u ON o.customer_id = u.id
                 LEFT JOIN users m ON o.mitra_id = m.id
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

            if (order.status !== 'pending') {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Pesanan dengan status ${order.status} tidak dapat diubah ke OTW`
                });
            }

            await connection.query(
                'UPDATE orders SET status = ? WHERE id = ?',
                ['otw', id]
            );

            await connection.commit();
            console.log(`✅ Order ${id} status updated from ${order.status} to 'otw'`);

            // 🔥 NOTIFIKASI: Mitra dalam perjalanan → Customer
            try {
                await notificationService.sendOrderOtwNotificationToCustomer(
                    order.customer_id,
                    id,
                    order.order_code,
                    order.mitra_name || 'Mitra'
                );
                console.log(`✅ [NOTIF] OTW sent to customer ${order.customer_id}`);
            } catch (err) {
                console.error('❌ [NOTIF] Error sending notification:', err.message);
            }

            return res.json({
                success: true,
                message: 'Status diperbarui: Dalam Perjalanan 🚗',
                data: { order_id: parseInt(id), status: 'otw' }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Error in otwOrder:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // ========================================================================
    // 14. MITRA START ORDER
    // ========================================================================
    startOrder: async (req, res) => {
        let connection;
        const { id } = req.params;
        const mitraId = req.user?.id;

        console.log(`\n========== [START ORDER] ==========`);
        console.log(`📝 Request params.id: ${id}`);
        console.log(`👤 Mitra ID: ${mitraId}`);

        if (!mitraId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized: Mitra ID tidak ditemukan'
            });
        }

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const [orderRows] = await connection.query(
                `SELECT o.*, u.name as customer_name, m.name as mitra_name
                 FROM orders o
                 LEFT JOIN users u ON o.customer_id = u.id
                 LEFT JOIN users m ON o.mitra_id = m.id
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

            if (order.status !== 'otw') {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Pesanan dengan status ${order.status} tidak dapat dimulai. Status harus 'otw' terlebih dahulu.`
                });
            }

            await connection.query(
                'UPDATE orders SET status = ? WHERE id = ?',
                ['ongoing', id]
            );

            await connection.commit();
            console.log(`✅ Order ${id} started, status now 'ongoing'`);

            // 🔥 NOTIFIKASI: Mitra mulai pekerjaan → Customer
            try {
                await notificationService.sendOrderOngoingNotificationToCustomer(
                    order.customer_id,
                    id,
                    order.order_code,
                    order.mitra_name || 'Mitra'
                );
                console.log(`✅ [NOTIF] Ongoing sent to customer ${order.customer_id}`);
            } catch (err) {
                console.error('❌ [NOTIF] Error sending notification:', err.message);
            }

            return res.json({
                success: true,
                message: 'Pekerjaan dimulai! 💪',
                data: { order_id: parseInt(id), status: 'ongoing' }
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

    // ========================================================================
    // 15. MITRA COMPLETE ORDER (DENGAN ESCROW)
    // ========================================================================
    completeOrder: async (req, res) => {
        let connection;
        const { id } = req.params;
        const mitraId = req.user?.id;

        console.log(`\n========== [COMPLETE ORDER] ==========`);
        console.log(`📝 Request params.id: ${id}`);
        console.log(`👤 Mitra ID from token: ${mitraId}`);

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

            if (order.status !== 'ongoing') {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Pesanan dengan status ${order.status} tidak dapat diselesaikan`
                });
            }

            // 🔥 Hitung escrow (80% mitra, 20% platform)
            const totalAmount = parseFloat(order.total_amount);
            const platformFee = totalAmount * 0.2;
            const escrowAmount = totalAmount - platformFee;

            // 1. Update status order ke 'completed' dengan escrow
            await connection.query(
                `UPDATE orders 
                 SET status = 'completed', 
                     completed_at = NOW(),
                     mitra_completed_at = NOW(),
                     mitra_earning = ?,
                     platform_fee = ?,
                     escrow_amount = ?,
                     release_status = 'pending'
                 WHERE id = ?`,
                [escrowAmount, platformFee, escrowAmount, id]
            );

            // 2. Update payment
            await connection.query(
                `UPDATE payments SET status = 'SUCCESS' WHERE order_id = ?`,
                [id]
            );

            // 3. 🔥 Schedule auto-release 24 jam kemudian
            await EscrowService.scheduleAutoRelease(id, connection);

            await connection.commit();
            console.log(`✅ Order ${id} completed! Escrow: Rp ${escrowAmount}`);

            // 🔥 KIRIM NOTIFIKASI
            try {
                // Ke Customer - Minta konfirmasi
                await notificationService.sendOrderCompletedNotificationToCustomer(
                    order.customer_id,
                    id,
                    order.order_code,
                    order.service_name || 'Layanan'
                );
                console.log(`✅ [NOTIF] Completion sent to customer ${order.customer_id}`);

                // Ke Customer - Request konfirmasi
                await notificationService.sendRequestConfirmationNotification(
                    order.customer_id,
                    id,
                    order.order_code,
                    req.user?.name || 'Mitra'
                );
                console.log(`✅ [NOTIF] Request confirmation sent to customer ${order.customer_id}`);

                // Ke Mitra - Info pesanan selesai
                await notificationService.sendOrderCompletedNotification(
                    mitraId,
                    id,
                    order.customer_name
                );
                console.log(`✅ [NOTIF] Completion sent to mitra ${mitraId}`);

            } catch (err) {
                console.error('❌ [NOTIF] Error sending notification:', err.message);
            }

            return res.json({
                success: true,
                message: 'Pesanan berhasil diselesaikan. Customer akan mengkonfirmasi untuk release dana.',
                data: {
                    order_id: parseInt(id),
                    status: 'completed',
                    release_status: 'pending',
                    escrow_amount: escrowAmount,
                    platform_fee: platformFee,
                    auto_release_at: moment.tz('Asia/Jakarta').add(24, 'hours').format('YYYY-MM-DD HH:mm:ss'),
                    mitra_earning: escrowAmount
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
    },

    // ========================================================================
    // 16. CUSTOMER CONFIRM ORDER COMPLETION (RELEASE ESCROW)
    // ========================================================================
    confirmOrderCompletion: async (req, res) => {
        let connection;
        const { id } = req.params;
        const customerId = req.user?.id;

        console.log(`\n========== [CONFIRM ORDER COMPLETION] ==========`);
        console.log(`📝 Order ID: ${id}`);
        console.log(`👤 Customer ID: ${customerId}`);

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // Cek order
            const [orderRows] = await connection.query(
                `SELECT o.*, u.name as customer_name, m.name as mitra_name
                 FROM orders o
                 LEFT JOIN users u ON o.customer_id = u.id
                 LEFT JOIN users m ON o.mitra_id = m.id
                 WHERE o.id = ? AND o.customer_id = ? AND o.status = 'completed'`,
                [id, customerId]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Order tidak ditemukan atau belum selesai'
                });
            }

            const order = orderRows[0];

            if (order.release_status !== 'pending') {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Dana sudah ${order.release_status === 'customer_confirmed' ? 'dikonfirmasi customer' : 'auto-release'}`
                });
            }

            // Cek apakah masih dalam batas waktu (24 jam)
            const now = moment.tz('Asia/Jakarta');
            const completedAt = moment(order.mitra_completed_at);
            const hoursElapsed = now.diff(completedAt, 'hours');

            if (hoursElapsed >= 24) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Batas waktu 24 jam untuk konfirmasi telah lewat. Dana akan otomatis cair.'
                });
            }

            // 🔥 Release escrow ke mitra
            const result = await EscrowService.releaseEscrowToMitra(
                id,
                'customer_confirmed',
                connection
            );

            await connection.commit();

            return res.json({
                success: true,
                message: 'Pesanan berhasil dikonfirmasi! Dana telah ditransfer ke mitra.',
                data: result
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Error confirming order completion:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // ========================================================================
    // 17. GET ORDER RELEASE STATUS
    // ========================================================================
    getOrderReleaseStatus: async (req, res) => {
        const { id } = req.params;
        const userId = req.user?.id;

        try {
            const [orders] = await db.query(
                `SELECT o.id, o.order_code, o.status, o.release_status, o.escrow_amount,
                        o.mitra_completed_at, o.auto_release_scheduled_at, o.escrow_released_at,
                        o.customer_confirmed_at,
                        TIMESTAMPDIFF(HOUR, o.mitra_completed_at, NOW()) as hours_since_completed
                 FROM orders o
                 WHERE o.id = ? AND (o.customer_id = ? OR o.mitra_id = ?)`,
                [id, userId, userId]
            );

            if (orders.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Order tidak ditemukan'
                });
            }

            const order = orders[0];
            const now = moment.tz('Asia/Jakarta');
            const completedAt = moment(order.mitra_completed_at);
            const hoursElapsed = now.diff(completedAt, 'hours');
            const hoursRemaining = Math.max(0, 24 - hoursElapsed);

            // Format status message
            let statusMessage = '';
            let canConfirm = false;

            switch (order.release_status) {
                case 'pending':
                    statusMessage = 'Menunggu konfirmasi customer';
                    canConfirm = hoursElapsed < 24;
                    break;
                case 'customer_confirmed':
                    statusMessage = '✅ Telah dikonfirmasi customer';
                    canConfirm = false;
                    break;
                case 'auto_released':
                    statusMessage = '💰 Dana otomatis cair (customer tidak konfirmasi)';
                    canConfirm = false;
                    break;
                default:
                    statusMessage = 'Status tidak dikenal';
                    canConfirm = false;
            }

            return res.json({
                success: true,
                data: {
                    order_id: order.id,
                    order_code: order.order_code,
                    status: order.status,
                    release_status: order.release_status,
                    escrow_amount: parseFloat(order.escrow_amount) || 0,
                    mitra_completed_at: order.mitra_completed_at,
                    auto_release_scheduled_at: order.auto_release_scheduled_at,
                    escrow_released_at: order.escrow_released_at,
                    customer_confirmed_at: order.customer_confirmed_at,
                    hours_elapsed: hoursElapsed,
                    hours_remaining: hoursRemaining,
                    can_confirm: canConfirm,
                    status_message: statusMessage,
                    release_deadline: moment(order.mitra_completed_at).add(24, 'hours').format('YYYY-MM-DD HH:mm:ss')
                }
            });

        } catch (error) {
            console.error('Error getting release status:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    },

    // ========================================================================
    // 18. UPDATE ORDER STATUS (ADMIN) - Legacy
    // ========================================================================
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
    }
};

module.exports = OrderController;