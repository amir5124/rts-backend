const db = require('../config/db');

class UserDevice {
    // Register or update device token
    static async registerOrUpdate(userId, deviceId, fcmToken, deviceName, deviceType) {
        const query = `
            INSERT INTO user_devices (user_id, device_id, fcm_token, device_name, device_type, is_active, last_used_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                fcm_token = VALUES(fcm_token),
                device_name = COALESCE(VALUES(device_name), device_name),
                device_type = COALESCE(VALUES(device_type), device_type),
                is_active = 1,
                last_used_at = NOW(),
                updated_at = NOW()
        `;

        const [result] = await db.execute(query, [userId, deviceId, fcmToken, deviceName, deviceType]);
        return result;
    }

    // Find device by device_id and user_id
    static async findByDeviceId(deviceId, userId = null) {
        let query = 'SELECT * FROM user_devices WHERE device_id = ?';
        const params = [deviceId];

        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }

        const [rows] = await db.execute(query, params);
        return rows[0];
    }

    // Get all active devices for a user
    static async getUserDevices(userId) {
        const query = `
            SELECT id, device_id, device_name, device_type, is_active, last_used_at, created_at
            FROM user_devices 
            WHERE user_id = ? AND is_active = 1
            ORDER BY last_used_at DESC
        `;
        const [rows] = await db.execute(query, [userId]);
        return rows;
    }

    // Update device token
    static async updateToken(deviceId, fcmToken, userId = null) {
        let query = 'UPDATE user_devices SET fcm_token = ?, last_used_at = NOW(), updated_at = NOW() WHERE device_id = ?';
        const params = [fcmToken, deviceId];

        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }

        const [result] = await db.execute(query, params);
        return result;
    }

    // Deactivate device (soft delete)
    static async deactivate(deviceId, userId = null) {
        let query = 'UPDATE user_devices SET is_active = 0, updated_at = NOW() WHERE device_id = ?';
        const params = [deviceId];

        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }

        const [result] = await db.execute(query, params);
        return result;
    }

    // Reactivate device
    static async reactivate(deviceId, userId) {
        const query = `
            UPDATE user_devices 
            SET is_active = 1, last_used_at = NOW(), updated_at = NOW() 
            WHERE device_id = ? AND user_id = ?
        `;
        const [result] = await db.execute(query, [deviceId, userId]);
        return result;
    }

    // Cleanup inactive devices (older than days)
    static async cleanupInactive(days = 30) {
        const query = `
            UPDATE user_devices 
            SET is_active = 0, updated_at = NOW() 
            WHERE is_active = 1 
            AND last_used_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        `;
        const [result] = await db.execute(query, [days]);
        return result;
    }

    // Delete device permanently
    static async delete(deviceId, userId = null) {
        let query = 'DELETE FROM user_devices WHERE device_id = ?';
        const params = [deviceId];

        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }

        const [result] = await db.execute(query, params);
        return result;
    }

    // Get FCM token by user_id
    static async getFCMTokensByUserId(userId) {
        const query = `
            SELECT device_id, fcm_token, device_type 
            FROM user_devices 
            WHERE user_id = ? AND is_active = 1 AND fcm_token IS NOT NULL
        `;
        const [rows] = await db.execute(query, [userId]);
        return rows;
    }

    // Update last used timestamp
    static async updateLastUsed(deviceId) {
        const query = 'UPDATE user_devices SET last_used_at = NOW() WHERE device_id = ?';
        const [result] = await db.execute(query, [deviceId]);
        return result;
    }
}

module.exports = UserDevice;