const UserDevice = require('../models/UserDevice');
const db = require('../config/db');

// Validasi input
const validateDeviceData = (data) => {
    const errors = {};

    if (!data.user_id) {
        errors.user_id = 'user_id wajib diisi';
    } else if (isNaN(data.user_id)) {
        errors.user_id = 'user_id harus berupa angka';
    }

    if (!data.device_id) {
        errors.device_id = 'device_id wajib diisi';
    } else if (data.device_id.length > 255) {
        errors.device_id = 'device_id maksimal 255 karakter';
    }

    if (!data.fcm_token) {
        errors.fcm_token = 'fcm_token wajib diisi';
    }

    if (data.device_type && !['ios', 'android', 'web'].includes(data.device_type)) {
        errors.device_type = 'device_type harus salah satu dari: ios, android, web';
    }

    return {
        isValid: Object.keys(errors).length === 0,
        errors
    };
};

// Register or update device token
const registerToken = async (req, res) => {
    console.log('📱 [REGISTER] Device token registration request:', {
        user_id: req.body.user_id,
        device_id: req.body.device_id,
        device_type: req.body.device_type,
        timestamp: new Date().toISOString()
    });

    try {
        // Validasi input
        const validation = validateDeviceData(req.body);
        if (!validation.isValid) {
            return res.status(422).json({
                success: false,
                message: 'Validasi gagal',
                errors: validation.errors
            });
        }

        const { user_id, device_id, fcm_token, device_name, device_type } = req.body;

        // Cek apakah user exists
        const [userCheck] = await db.execute('SELECT id FROM users WHERE id = ?', [user_id]);
        if (userCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User tidak ditemukan'
            });
        }

        // Cek apakah device sudah ada
        const existingDevice = await UserDevice.findByDeviceId(device_id, user_id);

        if (existingDevice) {
            // Update existing device
            await UserDevice.updateToken(device_id, fcm_token, user_id);

            // Update additional info
            const updateQuery = `
                UPDATE user_devices 
                SET device_name = COALESCE(?, device_name),
                    device_type = COALESCE(?, device_type),
                    is_active = 1,
                    last_used_at = NOW(),
                    updated_at = NOW()
                WHERE device_id = ? AND user_id = ?
            `;
            await db.execute(updateQuery, [device_name, device_type, device_id, user_id]);

            console.log('✅ [REGISTER] Device token updated:', {
                user_id,
                device_id,
                device_token_id: existingDevice.id
            });

            return res.status(200).json({
                success: true,
                message: 'Device token berhasil diperbarui',
                data: {
                    device_id: device_id,
                    user_id: user_id,
                    is_active: true,
                    last_used_at: new Date().toISOString()
                }
            });
        } else {
            // Create new device
            const result = await UserDevice.registerOrUpdate(
                user_id, device_id, fcm_token, device_name, device_type
            );

            console.log('✅ [REGISTER] New device token registered:', {
                user_id,
                device_id,
                insertId: result.insertId
            });

            return res.status(201).json({
                success: true,
                message: 'Device token berhasil didaftarkan',
                data: {
                    device_id: device_id,
                    user_id: user_id,
                    is_active: true,
                    created_at: new Date().toISOString()
                }
            });
        }

    } catch (error) {
        console.error('❌ [REGISTER] Error registering device token:', error);
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan saat registrasi device token',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Unregister/remove device token
const unregisterToken = async (req, res) => {
    console.log('🗑️ [UNREGISTER] Device unregistration request:', {
        device_id: req.body.device_id,
        user_id: req.body.user_id,
        timestamp: new Date().toISOString()
    });

    try {
        const { device_id, user_id } = req.body;

        if (!device_id) {
            return res.status(422).json({
                success: false,
                message: 'device_id wajib diisi'
            });
        }

        // Cek device exists
        const device = await UserDevice.findByDeviceId(device_id, user_id);

        if (!device) {
            return res.status(404).json({
                success: false,
                message: 'Device tidak ditemukan'
            });
        }

        // Deactivate device (soft delete)
        await UserDevice.deactivate(device_id, user_id);

        console.log('✅ [UNREGISTER] Device token unregistered:', {
            user_id: device.user_id,
            device_id: device.device_id,
            device_token_id: device.id
        });

        return res.status(200).json({
            success: true,
            message: 'Device token berhasil dihapus',
            data: {
                device_id: device_id,
                is_active: false
            }
        });

    } catch (error) {
        console.error('❌ [UNREGISTER] Error unregistering device token:', error);
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan saat menghapus device token',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all devices for a user
const getUserDevices = async (req, res) => {
    console.log('📱 [GET_DEVICES] Fetching devices for user:', req.params.userId);

    try {
        const { userId } = req.params;

        if (!userId || isNaN(userId)) {
            return res.status(422).json({
                success: false,
                message: 'user_id tidak valid'
            });
        }

        const devices = await UserDevice.getUserDevices(userId);

        console.log('✅ [GET_DEVICES] Devices found:', devices.length);

        return res.status(200).json({
            success: true,
            message: 'Daftar device user',
            data: devices,
            count: devices.length
        });

    } catch (error) {
        console.error('❌ [GET_DEVICES] Error getting user devices:', error);
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan saat mengambil data device',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Reactivate device token
const reactivateToken = async (req, res) => {
    console.log('🔄 [REACTIVATE] Reactivating device:', {
        device_id: req.body.device_id,
        user_id: req.body.user_id
    });

    try {
        const { device_id, user_id } = req.body;

        if (!device_id || !user_id) {
            return res.status(422).json({
                success: false,
                message: 'device_id dan user_id wajib diisi'
            });
        }

        // Cek device exists
        const device = await UserDevice.findByDeviceId(device_id, user_id);

        if (!device) {
            return res.status(404).json({
                success: false,
                message: 'Device tidak ditemukan'
            });
        }

        // Reactivate device
        await UserDevice.reactivate(device_id, user_id);

        console.log('✅ [REACTIVATE] Device reactivated:', {
            user_id,
            device_id
        });

        return res.status(200).json({
            success: true,
            message: 'Device token berhasil diaktifkan kembali',
            data: {
                device_id: device_id,
                is_active: true
            }
        });

    } catch (error) {
        console.error('❌ [REACTIVATE] Error reactivating device:', error);
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan saat mengaktifkan device token',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Cleanup inactive devices (cron job)
const cleanupInactiveDevices = async (req, res) => {
    console.log('🧹 [CLEANUP] Starting cleanup of inactive devices...');

    try {
        const days = req.body.days || 30;
        const result = await UserDevice.cleanupInactive(days);

        console.log('✅ [CLEANUP] Cleanup completed:', {
            affected_rows: result.affectedRows,
            inactive_days: days
        });

        return res.status(200).json({
            success: true,
            message: `Berhasil menonaktifkan ${result.affectedRows} device yang tidak aktif`,
            data: {
                deactivated_count: result.affectedRows,
                inactive_days: days
            }
        });

    } catch (error) {
        console.error('❌ [CLEANUP] Error cleaning up devices:', error);
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan saat membersihkan device',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update device last used timestamp
const updateLastUsed = async (req, res) => {
    try {
        const { device_id } = req.body;

        if (!device_id) {
            return res.status(422).json({
                success: false,
                message: 'device_id wajib diisi'
            });
        }

        await UserDevice.updateLastUsed(device_id);

        return res.status(200).json({
            success: true,
            message: 'Last used timestamp updated'
        });

    } catch (error) {
        console.error('❌ Error updating last used:', error);
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan'
        });
    }
};

// Delete device permanently
const deleteDevice = async (req, res) => {
    try {
        const { device_id, user_id } = req.body;

        if (!device_id) {
            return res.status(422).json({
                success: false,
                message: 'device_id wajib diisi'
            });
        }

        await UserDevice.delete(device_id, user_id);

        console.log('✅ Device permanently deleted:', device_id);

        return res.status(200).json({
            success: true,
            message: 'Device berhasil dihapus permanen'
        });

    } catch (error) {
        console.error('❌ Error deleting device:', error);
        return res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan'
        });
    }
};

module.exports = {
    registerToken,
    unregisterToken,
    getUserDevices,
    reactivateToken,
    cleanupInactiveDevices,
    updateLastUsed,
    deleteDevice
};