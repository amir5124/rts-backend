const db = require('../config/db');
const PaymentController = require('./paymentController');

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

            const [customerRows] = await connection.query(
                "SELECT name, phone, email FROM users WHERE id = ? FOR UPDATE",
                [customer_id]
            );
            const customer = customerRows[0];

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

    // 2. GET ORDERS BY CUSTOMER (DENGAN DATA PAYMENT LENGKAP)
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

    // 3. GET ORDER BY ID (DENGAN DATA PAYMENT LENGKAP)
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

            // Get mitra rating
            let mitraRating = 0;
            if (order.mitra_id) {
                const [ratingResult] = await connection.query(
                    "SELECT COALESCE(AVG(rating), 0) as avg_rating FROM reviews WHERE mitra_id = ?",
                    [order.mitra_id]
                );
                mitraRating = parseFloat(ratingResult[0]?.avg_rating) || 0;
            }

            // Format response
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

    // 4. CANCEL ORDER
    cancelOrder: async (req, res) => {
        let connection;
        const { id } = req.params;
        const { reason } = req.body;

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

            const allowedStatus = ['pending_payment'];
            if (!allowedStatus.includes(order[0].status)) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Order dengan status ${order[0].status} tidak dapat dibatalkan`
                });
            }

            await connection.query(
                'UPDATE orders SET status = ? WHERE id = ?',
                ['cancelled', id]
            );

            // Update payment status if exists
            await connection.query(
                'UPDATE payments SET status = ? WHERE order_id = ?',
                ['FAILED', id]
            );

            await connection.commit();

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

    // 5. GET ALL ORDERS (ADMIN ONLY) - DENGAN DATA PAYMENT
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

            // Get total count
            const [countResult] = await connection.query(countQuery, queryParams);
            const total = countResult[0].total;

            // Get paginated orders
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

    // 6. GET ORDER STATISTICS (ADMIN ONLY) - DENGAN DATA PAYMENT
    getOrderStatistics: async (req, res) => {
        let connection;

        try {
            connection = await db.getConnection();

            // Overview statistics
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

            // Status breakdown for orders
            const [byStatus] = await connection.query(`
                SELECT 
                    o.status,
                    COUNT(*) as total,
                    COALESCE(SUM(o.total_amount), 0) as total_amount
                FROM orders o
                GROUP BY o.status
                ORDER BY total DESC
            `);

            // Payment status breakdown
            const [byPaymentStatus] = await connection.query(`
                SELECT 
                    p.status,
                    COUNT(*) as total,
                    COALESCE(SUM(p.amount), 0) as total_amount
                FROM payments p
                GROUP BY p.status
                ORDER BY total DESC
            `);

            // Monthly statistics (last 12 months)
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

    // 7. UPDATE ORDER STATUS (ADMIN ONLY)
    updateOrderStatus: async (req, res) => {
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

            // Update payment status jika order status berubah menjadi completed
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
                data: { id, status }
            });
        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Error in updateOrderStatus:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 8. GET ORDERS BY MITRA (DENGAN DATA PAYMENT LENGKAP)
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
    }
};

module.exports = OrderController;