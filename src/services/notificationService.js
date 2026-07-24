// services/notificationService.js
const admin = require('../config/firebase-config');
const db = require('../config/db');

class NotificationService {

    // ========================================================================
    // 1. KIRIM NOTIFIKASI KE USER (PUSH NOTIFICATION + DATABASE)
    // ========================================================================
    async sendToUser(userId, notificationData, additionalData = {}) {
        let connection;

        // 🔥 Validasi userId
        const validUserId = parseInt(userId);
        if (isNaN(validUserId) || validUserId <= 0) {
            console.error(`❌ Invalid userId: ${userId}`);
            return { success: false, message: 'Invalid userId', deviceCount: 0 };
        }

        try {
            connection = await db.getConnection();

            // Ambil semua FCM token dari user devices yang aktif
            const [devices] = await connection.query(
                `SELECT fcm_token, device_type, device_name 
                 FROM user_devices 
                 WHERE user_id = ? AND is_active = 1 AND fcm_token IS NOT NULL AND fcm_token != ''`,
                [validUserId]
            );

            if (devices.length === 0) {
                console.log(`⚠️ No active devices with FCM token for user ${validUserId}`);
                return { success: false, message: 'No active devices', deviceCount: 0 };
            }

            const fcmTokens = devices.map(device => device.fcm_token);

            // Siapkan pesan notifikasi
            const message = {
                notification: {
                    title: notificationData.title,
                    body: notificationData.message,
                },
                data: {
                    type: notificationData.type || 'general',
                    user_id: validUserId.toString(),
                    timestamp: Date.now().toString(),
                    ...additionalData
                },
                tokens: fcmTokens,
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default',
                        channel_id: 'mitra_notifications'
                    }
                },
                apns: {
                    payload: {
                        aps: {
                            sound: 'default',
                            badge: 1
                        }
                    }
                }
            };

            // Kirim notifikasi multicast
            const response = await admin.messaging().sendEachForMulticast(message);

            console.log('✅ Push notification sent:', {
                userId: validUserId,
                successCount: response.successCount,
                failureCount: response.failureCount,
                totalDevices: devices.length
            });

            // Handle token yang tidak valid
            if (response.failureCount > 0) {
                await this.handleInvalidTokens(connection, fcmTokens, response.responses);
            }

            // 🔥 Simpan ke database
            await this.saveNotificationToDatabase(
                validUserId,
                notificationData.title,
                notificationData.message,
                notificationData.type || 'general',
                additionalData
            );

            return {
                success: true,
                successCount: response.successCount,
                failureCount: response.failureCount,
                deviceCount: devices.length
            };

        } catch (error) {
            console.error('❌ Error sending push notification:', error.message);
            return {
                success: false,
                message: error.message,
                deviceCount: 0
            };
        } finally {
            if (connection) connection.release();
        }
    }

    // ========================================================================
    // 2. HANDLE INVALID TOKENS
    // ========================================================================
    async handleInvalidTokens(connection, tokens, responses) {
        const invalidTokens = [];

        responses.forEach((resp, idx) => {
            if (!resp.success) {
                const errorCode = resp.error?.code;
                if (errorCode === 'messaging/registration-token-not-registered' ||
                    errorCode === 'messaging/invalid-registration-token') {
                    invalidTokens.push(tokens[idx]);
                }
            }
        });

        if (invalidTokens.length > 0) {
            await connection.query(
                'UPDATE user_devices SET is_active = 0 WHERE fcm_token IN (?)',
                [invalidTokens]
            );
            console.log(`✅ Deactivated ${invalidTokens.length} invalid tokens`);
        }
    }

    // ========================================================================
    // 3. SAVE NOTIFICATION TO DATABASE
    // ========================================================================
    async saveNotificationToDatabase(userId, title, message, type, data = null) {
        let connection;
        try {
            connection = await db.getConnection();

            const [tableCheck] = await connection.query(
                "SHOW TABLES LIKE 'notifications'"
            );

            if (tableCheck.length > 0) {
                await connection.query(
                    `INSERT INTO notifications (user_id, title, message, type, data, is_read, created_at) 
                     VALUES (?, ?, ?, ?, ?, 0, NOW())`,
                    [userId, title, message, type, data ? JSON.stringify(data) : null]
                );
                console.log(`✅ Notification saved to database for user ${userId}`);
            }
        } catch (error) {
            console.error('❌ Error saving notification to database:', error.message);
        } finally {
            if (connection) connection.release();
        }
    }

    // ========================================================================
    // 4. SEND TO MULTIPLE USERS
    // ========================================================================
    async sendToMultipleUsers(userIds, notificationData, additionalData = {}) {
        const results = [];

        for (const userId of userIds) {
            const result = await this.sendToUser(userId, notificationData, additionalData);
            results.push({ userId, ...result });
        }

        return {
            success: true,
            totalUsers: userIds.length,
            results: results
        };
    }

    // ========================================================================
    // 5. SEND TO ALL VERIFIED MITRAS
    // ========================================================================
    async sendToAllVerifiedMitras(notificationData, additionalData = {}) {
        let connection;

        try {
            connection = await db.getConnection();

            const [mitras] = await connection.query(
                `SELECT u.id FROM users u 
                 INNER JOIN mitra_details m ON u.id = m.user_id 
                 WHERE u.role = 'mitra' AND m.is_verified = 1 AND u.is_active = 1`
            );

            const userIds = mitras.map(m => m.id);

            if (userIds.length === 0) {
                return { success: false, message: 'No verified mitras found', totalUsers: 0 };
            }

            return await this.sendToMultipleUsers(userIds, notificationData, additionalData);

        } catch (error) {
            console.error('❌ Error sending to all mitras:', error.message);
            return { success: false, message: error.message };
        } finally {
            if (connection) connection.release();
        }
    }

    // ========================================================================
    // 6. NOTIFIKASI PESANAN - MITRA
    // ========================================================================

    /**
     * 🔥 Notifikasi ke mitra: Ada pesanan baru (dari customer)
     */
    async sendNewOrderNotificationToMitra(mitraId, orderId, customerName, serviceName, orderCode = null) {
        const notificationData = {
            title: '📦 Pesanan Baru!',
            message: `Halo, Anda mendapat pesanan baru dari ${customerName} untuk layanan ${serviceName}. Segera konfirmasi pesanan!`,
            type: 'new_order_to_mitra'
        };

        const additionalData = {
            screen: 'orders_mitra',
            action: 'view_order',
            order_id: orderId.toString(),
            order_code: orderCode || `ORD-${orderId}`,
            customer_name: customerName,
            service_name: serviceName
        };

        const result = await this.sendToUser(mitraId, notificationData, additionalData);
        console.log(`📢 New order notification sent to mitra ${mitraId} for order ${orderId}`);
        return result;
    }

    /**
     * 🔥 Notifikasi ke mitra: Pesanan dibatalkan oleh customer
     */
    async sendOrderCancelledNotification(mitraId, orderId, customerName, reason = null) {
        const reasonText = reason ? ` Alasan: ${reason}` : '';
        const notificationData = {
            title: '❌ Pesanan Dibatalkan',
            message: `Pesanan dari ${customerName} telah dibatalkan.${reasonText}`,
            type: 'order_cancelled_to_mitra'
        };

        const additionalData = {
            screen: 'orders_mitra',
            action: 'refresh_orders',
            order_id: orderId.toString(),
            status: 'cancelled'
        };

        const result = await this.sendToUser(mitraId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke mitra: Pesanan selesai (menunggu konfirmasi customer)
     */
    async sendOrderCompletedNotification(mitraId, orderId, customerName) {
        const notificationData = {
            title: '✅ Pesanan Selesai!',
            message: `Pesanan untuk ${customerName} telah selesai. Menunggu konfirmasi customer untuk release dana escrow.`,
            type: 'order_completed_to_mitra'
        };

        const additionalData = {
            screen: 'orders_mitra',
            action: 'view_order',
            order_id: orderId.toString(),
            status: 'completed'
        };

        const result = await this.sendToUser(mitraId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke mitra: Customer mengkonfirmasi pesanan selesai
     */
    async sendOrderConfirmedByCustomerNotification(mitraId, orderId, orderCode, customerName, amount) {
        const formattedAmount = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR'
        }).format(amount);

        const notificationData = {
            title: '✅ Customer Konfirmasi Pesanan!',
            message: `${customerName} telah mengkonfirmasi pesanan ${orderCode} selesai. Dana ${formattedAmount} telah masuk ke wallet Anda.`,
            type: 'customer_confirmed_order'
        };

        const additionalData = {
            screen: 'wallet_mitra',
            action: 'view_transaction',
            order_id: orderId.toString(),
            order_code: orderCode,
            amount: amount.toString()
        };

        const result = await this.sendToUser(mitraId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke mitra: Dana auto-release (customer tidak konfirmasi dalam 24 jam)
     */
    async sendAutoReleaseNotification(mitraId, orderId, orderCode, amount) {
        const formattedAmount = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR'
        }).format(amount);

        const notificationData = {
            title: '💰 Dana Otomatis Cair!',
            message: `Dana ${formattedAmount} untuk pesanan ${orderCode} telah otomatis cair karena customer belum mengkonfirmasi dalam 24 jam.`,
            type: 'auto_release_to_mitra'
        };

        const additionalData = {
            screen: 'wallet_mitra',
            action: 'view_transaction',
            order_id: orderId.toString(),
            order_code: orderCode,
            amount: amount.toString()
        };

        const result = await this.sendToUser(mitraId, notificationData, additionalData);
        return result;
    }

    // ========================================================================
    // 7. NOTIFIKASI PESANAN - CUSTOMER
    // ========================================================================

    /**
     * 🔥 Notifikasi ke customer: Pesanan dibuat
     */
    async sendOrderCreatedNotificationToCustomer(customerId, orderId, orderCode, totalAmount) {
        const formattedAmount = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR'
        }).format(totalAmount);

        const notificationData = {
            title: '🔄 Pesanan Diproses',
            message: `Pesanan Anda (${orderCode}) dengan total ${formattedAmount} sedang diproses. Silakan selesaikan pembayaran.`,
            type: 'order_created_to_customer'
        };

        const additionalData = {
            screen: 'orders',
            action: 'view_order',
            order_id: orderId.toString(),
            order_code: orderCode,
            status: 'pending_payment'
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke customer: Pesanan dikonfirmasi mitra
     */
    async sendOrderConfirmedNotificationToCustomer(customerId, orderId, orderCode, mitraName) {
        const notificationData = {
            title: '✅ Pesanan Dikonfirmasi',
            message: `Pesanan Anda (${orderCode}) telah dikonfirmasi oleh ${mitraName}. Mitra akan segera memproses pesanan Anda.`,
            type: 'order_confirmed_to_customer'
        };

        const additionalData = {
            screen: 'orders',
            action: 'view_order',
            order_id: orderId.toString(),
            order_code: orderCode,
            status: 'confirmed'
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke customer: Pesanan sedang diproses
     */
    async sendOrderProcessingNotificationToCustomer(customerId, orderId, orderCode) {
        const notificationData = {
            title: '🔄 Pesanan Diproses',
            message: `Pesanan Anda (${orderCode}) sedang diproses oleh mitra. Mohon tunggu ya.`,
            type: 'order_processing_to_customer'
        };

        const additionalData = {
            screen: 'orders',
            action: 'view_order',
            order_id: orderId.toString(),
            order_code: orderCode,
            status: 'processing'
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke customer: Mitra dalam perjalanan (OTW)
     */
    async sendOrderOtwNotificationToCustomer(customerId, orderId, orderCode, mitraName = 'Mitra') {
        const notificationData = {
            title: '🚗 Mitra Dalam Perjalanan',
            message: `${mitraName} sedang dalam perjalanan menuju lokasi Anda untuk pesanan ${orderCode}.`,
            type: 'order_otw_to_customer'
        };

        const additionalData = {
            screen: 'orders',
            action: 'track_order',
            order_id: orderId.toString(),
            order_code: orderCode,
            status: 'otw'
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke customer: Mitra mulai pekerjaan (Ongoing)
     */
    async sendOrderOngoingNotificationToCustomer(customerId, orderId, orderCode, mitraName = 'Mitra') {
        const notificationData = {
            title: '💪 Pekerjaan Dimulai',
            message: `${mitraName} telah mulai mengerjakan pesanan Anda (${orderCode}).`,
            type: 'order_ongoing_to_customer'
        };

        const additionalData = {
            screen: 'orders',
            action: 'view_order',
            order_id: orderId.toString(),
            order_code: orderCode,
            status: 'ongoing'
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke customer: Pesanan selesai (minta konfirmasi)
     */
    async sendOrderCompletedNotificationToCustomer(customerId, orderId, orderCode, serviceName) {
        const notificationData = {
            title: '✅ Pesanan Selesai!',
            message: `Pesanan untuk layanan ${serviceName} (${orderCode}) telah selesai. Mohon konfirmasi untuk me-release dana escrow.`,
            type: 'order_completed_to_customer'
        };

        const additionalData = {
            screen: 'orders',
            action: 'confirm_completion',
            order_id: orderId.toString(),
            order_code: orderCode,
            status: 'completed'
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke customer: Minta konfirmasi pesanan
     */
    async sendRequestConfirmationNotification(customerId, orderId, orderCode, mitraName) {
        const notificationData = {
            title: '📢 Konfirmasi Pesanan Selesai!',
            message: `Pesanan ${orderCode} oleh ${mitraName} telah selesai. Mohon konfirmasi untuk me-release dana escrow.`,
            type: 'request_confirmation_to_customer'
        };

        const additionalData = {
            screen: 'orders',
            action: 'confirm_completion',
            order_id: orderId.toString(),
            order_code: orderCode
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke customer: Terima kasih sudah konfirmasi
     */
    async sendThankYouForConfirmationNotification(customerId, orderId, orderCode) {
        const notificationData = {
            title: '🙏 Terima Kasih atas Konfirmasinya!',
            message: `Pesanan ${orderCode} telah Anda konfirmasi selesai. Dana telah kami transfer ke mitra.`,
            type: 'thank_you_confirmation_to_customer'
        };

        const additionalData = {
            screen: 'orders',
            action: 'view_order',
            order_id: orderId.toString(),
            order_code: orderCode
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke customer: Dana auto-release (karena tidak konfirmasi)
     */
    async sendAutoReleaseToCustomerNotification(customerId, orderId, orderCode) {
        const notificationData = {
            title: '⏰ Dana Otomatis Cair',
            message: `Karena Anda belum mengkonfirmasi pesanan ${orderCode} dalam 24 jam, dana telah otomatis kami transfer ke mitra.`,
            type: 'auto_release_to_customer'
        };

        const additionalData = {
            screen: 'orders',
            action: 'view_order',
            order_id: orderId.toString(),
            order_code: orderCode
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke customer: Pesanan dibatalkan
     */
    async sendOrderCancelledNotificationToCustomer(customerId, orderId, orderCode, reason = null) {
        const reasonText = reason ? ` Alasan: ${reason}` : '';
        const notificationData = {
            title: '❌ Pesanan Dibatalkan',
            message: `Pesanan Anda (${orderCode}) telah dibatalkan.${reasonText}`,
            type: 'order_cancelled_to_customer'
        };

        const additionalData = {
            screen: 'orders',
            action: 'refresh_orders',
            order_id: orderId.toString(),
            order_code: orderCode,
            status: 'cancelled'
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke customer: Pembayaran berhasil
     */
    async sendPaymentSuccessNotificationToCustomer(customerId, orderId, orderCode, totalAmount) {
        const formattedAmount = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR'
        }).format(totalAmount);

        const notificationData = {
            title: '✅ Pembayaran Berhasil!',
            message: `Pembayaran untuk pesanan ${orderCode} sebesar ${formattedAmount} telah berhasil. Pesanan Anda akan segera diproses oleh mitra.`,
            type: 'payment_success_to_customer'
        };

        const additionalData = {
            screen: 'orders',
            action: 'view_order',
            order_id: orderId.toString(),
            order_code: orderCode,
            status: 'paid'
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);
        return result;
    }

    // ========================================================================
    // 8. NOTIFIKASI VERIFIKASI AKUN
    // ========================================================================

    /**
     * 🔥 Notifikasi ke mitra: Akun diverifikasi
     */
    async sendVerificationNotification(userId, mitraName = 'Mitra') {
        const notificationData = {
            title: '✅ Akun Diverifikasi!',
            message: `Selamat ${mitraName}! Akun mitra Anda telah diverifikasi. Anda sekarang dapat mulai menerima pesanan dari pelanggan.`,
            type: 'verification_success'
        };

        const additionalData = {
            screen: 'dashboard_mitra',
            action: 'refresh_data',
            verification_status: 'approved'
        };

        const result = await this.sendToUser(userId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke mitra: Verifikasi dibatalkan
     */
    async sendUnverificationNotification(userId, mitraName = 'Mitra', reason = null) {
        const reasonText = reason ? ` Alasan: ${reason}` : '';
        const notificationData = {
            title: '⚠️ Verifikasi Dibatalkan',
            message: `Halo ${mitraName}, verifikasi akun mitra Anda telah dibatalkan.${reasonText} Silakan lengkapi data atau hubungi admin.`,
            type: 'unverification'
        };

        const additionalData = {
            screen: 'profile_mitra',
            action: 'check_status',
            verification_status: 'unverified'
        };

        const result = await this.sendToUser(userId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke mitra: Pendaftaran ditolak
     */
    async sendRejectionNotification(userId, reason = '', mitraName = 'Mitra') {
        const message = reason
            ? `Halo ${mitraName}, maaf pendaftaran mitra Anda ditolak. Alasan: ${reason}. Silakan perbaiki data dan daftar ulang.`
            : `Halo ${mitraName}, maaf pendaftaran mitra Anda ditolak. Silakan hubungi admin untuk informasi lebih lanjut.`;

        const notificationData = {
            title: '❌ Pendaftaran Ditolak',
            message: message,
            type: 'rejection'
        };

        const additionalData = {
            screen: 'register_mitra',
            action: 'rejected',
            can_retry: 'true'
        };

        const result = await this.sendToUser(userId, notificationData, additionalData);
        return result;
    }

    // ========================================================================
    // 9. NOTIFIKASI AKUN
    // ========================================================================

    /**
     * 🔥 Notifikasi ke mitra: Akun dinonaktifkan
     */
    async sendAccountDeactivationNotification(userId, mitraName = 'Mitra') {
        const notificationData = {
            title: '🗑️ Akun Dinonaktifkan',
            message: `Halo ${mitraName}, akun mitra Anda telah dinonaktifkan oleh administrator. Akun Anda telah diubah menjadi akun pelanggan.`,
            type: 'account_deactivation'
        };

        const additionalData = {
            screen: 'login',
            action: 'logout',
            account_status: 'deactivated',
            new_role: 'customer'
        };

        const result = await this.sendToUser(userId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke mitra: Akun diaktifkan kembali
     */
    async sendAccountReactivationNotification(userId, mitraName = 'Mitra') {
        const notificationData = {
            title: '✅ Akun Diaktifkan Kembali',
            message: `Halo ${mitraName}, akun mitra Anda telah diaktifkan kembali oleh administrator. Anda sekarang dapat kembali menerima pesanan.`,
            type: 'account_reactivation'
        };

        const additionalData = {
            screen: 'dashboard_mitra',
            action: 'refresh_data',
            account_status: 'active'
        };

        const result = await this.sendToUser(userId, notificationData, additionalData);
        return result;
    }

    // ========================================================================
    // 10. NOTIFIKASI WALLET & PENCAIRAN DANA
    // ========================================================================

    /**
     * 🔥 Notifikasi ke mitra: Pencairan dana berhasil
     */
    async sendWithdrawalSuccessNotification(userId, amount, bankName) {
        const formattedAmount = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR'
        }).format(amount);

        const notificationData = {
            title: '💰 Pencairan Dana Berhasil',
            message: `Pencairan dana sebesar ${formattedAmount} ke rekening ${bankName} telah berhasil diproses.`,
            type: 'withdrawal_success'
        };

        const additionalData = {
            screen: 'wallet_mitra',
            action: 'refresh_balance'
        };

        const result = await this.sendToUser(userId, notificationData, additionalData);
        return result;
    }

    /**
     * 🔥 Notifikasi ke mitra: Pencairan dana gagal
     */
    async sendWithdrawalFailedNotification(userId, amount, reason) {
        const formattedAmount = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR'
        }).format(amount);

        const notificationData = {
            title: '⚠️ Pencairan Dana Gagal',
            message: `Pencairan dana sebesar ${formattedAmount} gagal. Alasan: ${reason}. Silakan coba lagi atau hubungi admin.`,
            type: 'withdrawal_failed'
        };

        const additionalData = {
            screen: 'wallet_mitra',
            action: 'retry_withdrawal'
        };

        const result = await this.sendToUser(userId, notificationData, additionalData);
        return result;
    }

    // ========================================================================
    // 11. LEGACY / ALIAS METHODS (Untuk kompatibilitas)
    // ========================================================================

    // Alias untuk sendNewOrderNotificationToMitra
    async sendNewOrderNotification(userId, orderId, customerName, serviceName) {
        return await this.sendNewOrderNotificationToMitra(userId, orderId, customerName, serviceName);
    }
}

module.exports = new NotificationService();