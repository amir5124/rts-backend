// services/escrowService.js
const db = require('../config/db');
const moment = require('moment-timezone');
const notificationService = require('./notificationService');
const walletService = require('./walletService');

const EscrowService = {
    /**
     * 🔥 RELEASE DANA ESCROW KE MITRA
     * - Jika customer confirmed → release langsung
     * - Jika auto-release (24 jam) → release otomatis
     */
    releaseEscrowToMitra: async (orderId, releaseType = 'customer_confirmed', connection = null) => {
        const client = connection || db;
        let shouldCommit = false;

        try {
            // Jika pakai koneksi sendiri, buat transaksi
            if (!connection) {
                await client.beginTransaction();
                shouldCommit = true;
            }

            // 1. Get order detail
            const [orders] = await client.query(
                `SELECT o.*, 
                        u.name as customer_name, u.phone as customer_phone,
                        m.name as mitra_name, m.phone as mitra_phone,
                        m.id as mitra_id
                 FROM orders o
                 LEFT JOIN users u ON o.customer_id = u.id
                 LEFT JOIN users m ON o.mitra_id = m.id
                 WHERE o.id = ? AND o.status = 'completed'`,
                [orderId]
            );

            if (orders.length === 0) {
                throw new Error('Order tidak ditemukan atau belum selesai');
            }

            const order = orders[0];

            // Cek apakah sudah release
            if (order.release_status !== 'pending') {
                console.log(`ℹ️ Order ${orderId} already released (status: ${order.release_status})`);
                return { already_released: true, status: order.release_status };
            }

            const mitraId = order.mitra_id;
            const escrowAmount = parseFloat(order.escrow_amount) || 0;

            if (escrowAmount <= 0) {
                console.log(`⚠️ Escrow amount 0 for order ${orderId}, skipping release`);
                return { skipped: true, message: 'Escrow amount is 0' };
            }

            // 2. Update status order
            const releaseStatus = releaseType === 'customer_confirmed' ? 'customer_confirmed' : 'auto_released';
            const releasedAt = new Date();

            await client.query(
                `UPDATE orders 
                 SET release_status = ?, 
                     escrow_released_at = ?,
                     customer_confirmed_at = ?,
                     updated_at = NOW()
                 WHERE id = ?`,
                [
                    releaseStatus,
                    releasedAt,
                    releaseType === 'customer_confirmed' ? releasedAt : null,
                    orderId
                ]
            );

            // 3. Credit ke wallet mitra
            const earningResult = await walletService.creditMitraEarning(
                mitraId,
                orderId,
                order.order_code,
                escrowAmount,
                client
            );

            // 4. Commit jika transaksi sendiri
            if (shouldCommit) {
                await client.commit();
            }

            console.log(`✅ [ESCROW] Released Rp ${escrowAmount} to mitra ${mitraId} (${releaseType})`);

            // 5. Kirim notifikasi (di luar transaksi)
            try {
                if (releaseType === 'customer_confirmed') {
                    // Notifikasi ke mitra: Customer telah konfirmasi
                    await notificationService.sendOrderConfirmedByCustomerNotification(
                        mitraId,
                        orderId,
                        order.order_code,
                        order.customer_name,
                        escrowAmount
                    );

                    // Notifikasi ke customer: Terima kasih sudah konfirmasi
                    await notificationService.sendThankYouForConfirmationNotification(
                        order.customer_id,
                        orderId,
                        order.order_code
                    );
                } else {
                    // Auto-release: Notifikasi ke mitra
                    await notificationService.sendAutoReleaseNotification(
                        mitraId,
                        orderId,
                        order.order_code,
                        escrowAmount
                    );

                    // Notifikasi ke customer: Dana otomatis cair karena belum konfirmasi
                    await notificationService.sendAutoReleaseToCustomerNotification(
                        order.customer_id,
                        orderId,
                        order.order_code
                    );
                }
            } catch (err) {
                console.error('❌ Error sending release notification:', err.message);
            }

            return {
                success: true,
                order_id: orderId,
                mitra_id: mitraId,
                escrow_amount: escrowAmount,
                release_type: releaseType,
                release_status: releaseStatus,
                released_at: releasedAt,
                mitra_earning: earningResult?.mitraEarning || escrowAmount * 0.8,
                platform_fee: earningResult?.platformFee || escrowAmount * 0.2
            };

        } catch (error) {
            if (shouldCommit) {
                await client.rollback();
            }
            console.error('❌ Error releasing escrow:', error.message);
            throw error;
        } finally {
            if (shouldCommit && connection) {
                // Jika kita yang buat koneksi, release
            }
        }
    },

    /**
     * 🔥 SCHEDULE AUTO-RELEASE (24 jam setelah mitra selesai)
     */
    scheduleAutoRelease: async (orderId, connection = null) => {
        const client = connection || db;

        try {
            const scheduledAt = moment.tz('Asia/Jakarta')
                .add(24, 'hours')
                .format('YYYY-MM-DD HH:mm:ss');

            await client.query(
                `UPDATE orders 
                 SET auto_release_scheduled_at = ?,
                     updated_at = NOW()
                 WHERE id = ?`,
                [scheduledAt, orderId]
            );

            console.log(`📅 [ESCROW] Auto-release scheduled for order ${orderId} at ${scheduledAt}`);
            return { scheduled_at: scheduledAt };
        } catch (error) {
            console.error('❌ Error scheduling auto-release:', error.message);
            throw error;
        }
    },

    /**
     * 🔥 CEK & EKSEKUSI AUTO-RELEASE (Cron Job)
     * Panggil setiap 5-10 menit
     */
    processAutoRelease: async () => {
        console.log('🔄 [CRON] Checking for auto-release...');

        let connection;
        try {
            connection = await db.getConnection();

            // Cari order yang sudah lewat 24 jam dari mitra_completed_at
            // dan belum release, serta statusnya completed
            const [orders] = await connection.query(
                `SELECT o.id, o.mitra_completed_at, o.auto_release_scheduled_at
                 FROM orders o
                 WHERE o.status = 'completed'
                   AND o.release_status = 'pending'
                   AND o.mitra_completed_at IS NOT NULL
                   AND o.auto_release_scheduled_at IS NOT NULL
                   AND o.auto_release_scheduled_at <= NOW()
                   AND o.escrow_amount > 0
                 LIMIT 10`,
                []
            );

            if (orders.length === 0) {
                console.log('ℹ️ No orders pending auto-release');
                return { processed: 0 };
            }

            console.log(`📦 Found ${orders.length} orders to auto-release`);

            const results = [];
            for (const order of orders) {
                try {
                    const result = await EscrowService.releaseEscrowToMitra(
                        order.id,
                        'auto_released',
                        connection
                    );
                    results.push({ order_id: order.id, ...result });
                    console.log(`✅ Auto-released order ${order.id}`);
                } catch (err) {
                    console.error(`❌ Failed to auto-release order ${order.id}:`, err.message);
                    results.push({ order_id: order.id, error: err.message });
                }
            }

            await connection.commit();
            return { processed: orders.length, results };

        } catch (error) {
            console.error('❌ Error processing auto-release:', error.message);
            if (connection) await connection.rollback();
            throw error;
        } finally {
            if (connection) connection.release();
        }
    }
};

module.exports = EscrowService;