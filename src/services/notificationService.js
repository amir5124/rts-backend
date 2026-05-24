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
                return null;
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

            return response;

        } catch (error) {
            console.error('❌ Error sending push notification:', error.message);
            // Jangan throw error biar proses tetap jalan
            return null;
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

    // Kirim notifikasi verifikasi akun mitra
    async sendVerificationNotification(userId, mitraName = 'Mitra') {
        const notificationData = {
            title: '✅ Akun Diverifikasi!',
            message: 'Selamat! Akun mitra Anda telah diverifikasi. Anda sekarang dapat mulai menerima pesanan dari pelanggan.',
            type: 'verification'
        };

        const additionalData = {
            screen: 'dashboard_mitra',
            action: 'refresh_data',
            verification_status: 'approved'
        };

        return await this.sendToUser(userId, notificationData, additionalData);
    }

    // Kirim notifikasi penolakan akun mitra
    async sendRejectionNotification(userId, reason = '') {
        const message = reason
            ? `Maaf, pendaftaran mitra Anda ditolak. Alasan: ${reason}`
            : 'Maaf, pendaftaran mitra Anda ditolak. Silakan hubungi admin untuk informasi lebih lanjut.';

        const notificationData = {
            title: '❌ Pendaftaran Ditolak',
            message: message,
            type: 'rejection'
        };

        const additionalData = {
            screen: 'register_mitra',
            action: 'rejected'
        };

        return await this.sendToUser(userId, notificationData, additionalData);
    }
}

module.exports = new NotificationService();