// services/notificationService.js
const admin = require('../config/firebase-config');
const db = require('../config/db');

class NotificationService {

    // Kirim notifikasi ke user berdasarkan user_id
    async sendToUser(userId, notificationData, additionalData = {}) {
        let connection;

        try {
            connection = await db.getConnection();

            // Ambil semua FCM token dari user devices yang aktif
            const [devices] = await connection.query(
                `SELECT fcm_token, device_type, device_name 
                 FROM user_devices 
                 WHERE user_id = ? AND is_active = 1 AND fcm_token IS NOT NULL AND fcm_token != ''`,
                [userId]
            );

            if (devices.length === 0) {
                console.log(`⚠️ No active devices with FCM token for user ${userId}`);
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
                    user_id: userId.toString(),
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
                userId: userId,
                successCount: response.successCount,
                failureCount: response.failureCount,
                totalDevices: devices.length
            });

            // Handle token yang tidak valid
            if (response.failureCount > 0) {
                await this.handleInvalidTokens(connection, fcmTokens, response.responses);
            }

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

    // Handle token yang tidak valid/expired
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
            // Nonaktifkan device dengan token tidak valid
            await connection.query(
                'UPDATE user_devices SET is_active = 0 WHERE fcm_token IN (?)',
                [invalidTokens]
            );
            console.log(`✅ Deactivated ${invalidTokens.length} invalid tokens`);
        }
    }

    // ========== NOTIFIKASI PESANAN UNTUK MITRA ==========

    // Kirim notifikasi pesanan baru ke mitra (dari customer)
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

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(mitraId, notificationData.title, notificationData.message, 'order');

        console.log(`📢 New order notification sent to mitra ${mitraId} for order ${orderId}`);
        return result;
    }

    // Kirim notifikasi pesanan baru ke customer (setelah order dibuat)
    async sendOrderCreatedNotificationToCustomer(customerId, orderId, orderCode, totalAmount) {
        const formattedAmount = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(totalAmount);
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

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(customerId, notificationData.title, notificationData.message, 'order');

        console.log(`📢 Order created notification sent to customer ${customerId} for order ${orderId}`);
        return result;
    }

    // Kirim notifikasi pesanan dikonfirmasi ke customer
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

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(customerId, notificationData.title, notificationData.message, 'order');

        return result;
    }

    // Kirim notifikasi pesanan diproses ke customer
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

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(customerId, notificationData.title, notificationData.message, 'order');

        return result;
    }

    // Kirim notifikasi pesanan selesai ke customer
    async sendOrderCompletedNotificationToCustomer(customerId, orderId, orderCode, serviceName) {
        const notificationData = {
            title: '✅ Pesanan Selesai',
            message: `Pesanan Anda untuk layanan ${serviceName} (${orderCode}) telah selesai. Silakan berikan rating dan ulasan ya!`,
            type: 'order_completed_to_customer'
        };

        const additionalData = {
            screen: 'orders',
            action: 'rate_order',
            order_id: orderId.toString(),
            order_code: orderCode,
            status: 'completed'
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(customerId, notificationData.title, notificationData.message, 'order');

        return result;
    }

    // Kirim notifikasi pesanan dibatalkan ke customer
    async sendOrderCancelledNotificationToCustomer(customerId, orderId, orderCode, reason = null) {
        const reasonText = reason ? ` Alasan: ${reason}` : '';
        const notificationData = {
            title: '❌ Pesanan Dibatalkan',
            message: `Pesanan Anda (${orderCode}) telah dibatalkan.${reasonText} Dana akan dikembalikan ke saldo Anda.`,
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

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(customerId, notificationData.title, notificationData.message, 'order');

        return result;
    }

    // ========== NOTIFIKASI PESANAN UNTUK MITRA (LEGACY) ==========

    // Kirim notifikasi pesanan baru (untuk mitra) - alias dari sendNewOrderNotificationToMitra
    async sendNewOrderNotification(userId, orderId, customerName, serviceName) {
        return await this.sendNewOrderNotificationToMitra(userId, orderId, customerName, serviceName);
    }

    // Kirim notifikasi pesanan dibatalkan (untuk mitra)
    async sendOrderCancelledNotification(userId, orderId, customerName, reason = null) {
        const reasonText = reason ? ` Alasan: ${reason}` : '';
        const notificationData = {
            title: '❌ Pesanan Dibatalkan',
            message: `Pesanan dari ${customerName} telah dibatalkan.${reasonText}`,
            type: 'order_cancelled'
        };

        const additionalData = {
            screen: 'orders_mitra',
            action: 'refresh_orders',
            order_id: orderId.toString(),
            status: 'cancelled'
        };

        const result = await this.sendToUser(userId, notificationData, additionalData);

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(userId, notificationData.title, notificationData.message, 'order');

        return result;
    }

    // Kirim notifikasi pesanan selesai (untuk mitra)
    async sendOrderCompletedNotification(userId, orderId, customerName) {
        const notificationData = {
            title: '✅ Pesanan Selesai',
            message: `Pesanan untuk ${customerName} telah selesai. Jangan lupa minta rating ya!`,
            type: 'order_completed'
        };

        const additionalData = {
            screen: 'orders_mitra',
            action: 'view_order',
            order_id: orderId.toString(),
            status: 'completed'
        };

        const result = await this.sendToUser(userId, notificationData, additionalData);

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(userId, notificationData.title, notificationData.message, 'order');

        return result;
    }

    // ========== NOTIFIKASI VERIFIKASI ==========

    // Kirim notifikasi verifikasi akun mitra (APPROVE)
    async sendVerificationNotification(userId, mitraName = 'Mitra') {
        const notificationData = {
            title: '✅ Akun Diverifikasi!',
            message: `Selamat ${mitraName}! Akun mitra Anda telah diverifikasi. Anda sekarang dapat mulai menerima pesanan dari pelanggan.`,
            type: 'verification'
        };

        const additionalData = {
            screen: 'dashboard_mitra',
            action: 'refresh_data',
            verification_status: 'approved'
        };

        const result = await this.sendToUser(userId, notificationData, additionalData);

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(userId, notificationData.title, notificationData.message, 'verification');

        return result;
    }

    // Kirim notifikasi pembatalan verifikasi (UNVERIFY)
    async sendUnverificationNotification(userId, mitraName = 'Mitra', reason = null) {
        const reasonText = reason ? ` Alasan: ${reason}` : '';
        const notificationData = {
            title: '⚠️ Verifikasi Dibatalkan',
            message: `Halo ${mitraName}, verifikasi akun mitra Anda telah dibatalkan.${reasonText} Silakan lengkapi data atau hubungi admin untuk informasi lebih lanjut.`,
            type: 'unverification'
        };

        const additionalData = {
            screen: 'profile_mitra',
            action: 'check_status',
            verification_status: 'unverified'
        };

        const result = await this.sendToUser(userId, notificationData, additionalData);

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(userId, notificationData.title, notificationData.message, 'warning');

        return result;
    }

    // Kirim notifikasi penolakan pendaftaran mitra (REJECTION)
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

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(userId, notificationData.title, notificationData.message, 'rejection');

        return result;
    }

    // ========== NOTIFIKASI AKUN ==========

    // Kirim notifikasi penonaktifan akun (DEACTIVATION)
    async sendAccountDeactivationNotification(userId, mitraName = 'Mitra') {
        const notificationData = {
            title: '🗑️ Akun Dinonaktifkan',
            message: `Halo ${mitraName}, akun mitra Anda telah dinonaktifkan oleh administrator. Akun Anda telah diubah menjadi akun pelanggan. Silakan hubungi admin jika ada pertanyaan.`,
            type: 'account_deactivation'
        };

        const additionalData = {
            screen: 'login',
            action: 'logout',
            account_status: 'deactivated',
            new_role: 'customer'
        };

        const result = await this.sendToUser(userId, notificationData, additionalData);

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(userId, notificationData.title, notificationData.message, 'account_deactivation');

        return result;
    }

    // Kirim notifikasi reaktivasi akun (REACTIVATION)
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

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(userId, notificationData.title, notificationData.message, 'account_reactivation');

        return result;
    }

    // ========== NOTIFIKASI PENCAIRAN DANA ==========

    // Kirim notifikasi pencairan dana berhasil
    async sendWithdrawalSuccessNotification(userId, amount, bankName) {
        const formattedAmount = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(amount);
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

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(userId, notificationData.title, notificationData.message, 'withdrawal');

        return result;
    }

    // Kirim notifikasi pencairan dana gagal
    async sendWithdrawalFailedNotification(userId, amount, reason) {
        const formattedAmount = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(amount);
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

        // Simpan ke database notifications
        await this.saveNotificationToDatabase(userId, notificationData.title, notificationData.message, 'withdrawal');

        return result;
    }

    // Di notificationService.js tambahkan method ini jika belum ada
    async sendPaymentSuccessNotificationToCustomer(customerId, orderId, orderCode, totalAmount) {
        const formattedAmount = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR'
        }).format(totalAmount);

        const notificationData = {
            title: '✅ Pembayaran Berhasil!',
            message: `Pembayaran untuk pesanan ${orderCode} sebesar ${formattedAmount} telah berhasil. Pesanan Anda akan segera diproses oleh mitra.`,
            type: 'payment_success'
        };

        const additionalData = {
            screen: 'orders',
            action: 'view_order',
            order_id: orderId.toString(),
            order_code: orderCode,
            status: 'paid'
        };

        const result = await this.sendToUser(customerId, notificationData, additionalData);
        await this.saveNotificationToDatabase(customerId, notificationData.title, notificationData.message, 'payment');

        return result;
    }

    // ========== FUNGSI BANTUAN ==========

    // Simpan notifikasi ke database
    async saveNotificationToDatabase(userId, title, message, type) {
        let connection;
        try {
            connection = await db.getConnection();

            const [tableCheck] = await connection.query(
                "SHOW TABLES LIKE 'notifications'"
            );

            if (tableCheck.length > 0) {
                await connection.query(
                    `INSERT INTO notifications (user_id, title, message, type, is_read, created_at) 
                     VALUES (?, ?, ?, ?, 0, NOW())`,
                    [userId, title, message, type]
                );
                console.log(`✅ Notification saved to database for user ${userId}`);
            }
        } catch (error) {
            console.error('❌ Error saving notification to database:', error.message);
        } finally {
            if (connection) connection.release();
        }
    }

    // Kirim notifikasi massal ke banyak user
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

    // Kirim notifikasi ke semua mitra terverifikasi
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
}

module.exports = new NotificationService();