const db = require('../config/db');
const bcrypt = require('bcrypt');
const notificationService = require('../services/notificationService');
const fs = require('fs');
const path = require('path');

const UPLOAD_BASE_PATH = process.env.UPLOAD_PATH || '/app/uploads';
const CERTIFICATES_PATH = path.join(UPLOAD_BASE_PATH, 'certificates');

// Pastikan folder certificates ada
if (!fs.existsSync(CERTIFICATES_PATH)) {
    fs.mkdirSync(CERTIFICATES_PATH, { recursive: true });
    console.log(`📁 [MITRA] Created certificates directory: ${CERTIFICATES_PATH}`);
}

console.log(`📁 [MITRA] CERTIFICATES_PATH: ${CERTIFICATES_PATH}`);

const mitraController = {

    // Registrasi Mitra Baru
    registerMitra: async (req, res) => {
        let connection;

        try {
            const {
                user_id,
                specialization,
                certificate_url,
                address,
                address_latitude,
                address_longitude,
                service_radius_km,
                working_days,
                working_start,
                working_end,
                bank_name,
                bank_account_number,
                bank_account_name
            } = req.body;

            if (!user_id || !specialization || !address) {
                return res.status(400).json({
                    success: false,
                    message: 'user_id, specialization, dan address wajib diisi'
                });
            }

            connection = await db.getConnection();
            await connection.beginTransaction();

            const [userCheck] = await connection.query(
                'SELECT id, role FROM users WHERE id = ? AND role = "mitra"',
                [user_id]
            );

            if (userCheck.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'User mitra tidak ditemukan'
                });
            }

            const [mitraCheck] = await connection.query(
                'SELECT id FROM mitra_details WHERE user_id = ?',
                [user_id]
            );

            if (mitraCheck.length > 0) {
                await connection.rollback();
                return res.status(409).json({
                    success: false,
                    message: 'Mitra sudah terdaftar'
                });
            }

            // 🔥 PERBAIKAN: Proses certificate_url dengan path yang benar
            let finalCertificateUrl = null;

            if (certificate_url) {
                const isBase64 = certificate_url.startsWith('data:image') ||
                    certificate_url.startsWith('data:application/pdf') ||
                    /^[A-Za-z0-9+/=]+$/.test(certificate_url.substring(0, 100));

                if (isBase64 && (certificate_url.includes('base64') || certificate_url.length > 500)) {
                    try {
                        // 🔥 Gunakan CERTIFICATES_PATH dari environment
                        if (!fs.existsSync(CERTIFICATES_PATH)) {
                            fs.mkdirSync(CERTIFICATES_PATH, { recursive: true });
                        }

                        let base64Data = certificate_url;
                        let fileExtension = 'jpg';

                        if (certificate_url.startsWith('data:image')) {
                            const matches = certificate_url.match(/^data:image\/(\w+);base64,/);
                            if (matches && matches[1]) {
                                fileExtension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
                            }
                            base64Data = certificate_url.replace(/^data:image\/\w+;base64,/, '');
                        } else if (certificate_url.startsWith('data:application/pdf')) {
                            fileExtension = 'pdf';
                            base64Data = certificate_url.replace(/^data:application\/pdf;base64,/, '');
                        } else if (certificate_url.includes('base64,')) {
                            base64Data = certificate_url.split('base64,')[1];
                        }

                        const filename = `cert_${user_id}_${Date.now()}.${fileExtension}`;
                        const filepath = path.join(CERTIFICATES_PATH, filename);

                        fs.writeFileSync(filepath, base64Data, 'base64');
                        finalCertificateUrl = `/uploads/certificates/${filename}`;

                        console.log(`✅ Certificate saved: ${finalCertificateUrl} at ${filepath}`);
                    } catch (fileError) {
                        console.error('❌ Error saving certificate file:', fileError);
                        finalCertificateUrl = certificate_url;
                    }
                } else {
                    finalCertificateUrl = certificate_url;
                }
            }

            let specializationValue = specialization;
            if (Array.isArray(specialization)) {
                specializationValue = JSON.stringify(specialization);
            }

            let workingDaysValue = working_days;
            if (Array.isArray(working_days)) {
                workingDaysValue = JSON.stringify(working_days);
            }

            const mitraQuery = `
                INSERT INTO mitra_details (
                    user_id, specialization, certificate_url, address,
                    address_latitude, address_longitude, service_radius_km, 
                    working_days, working_start, working_end,
                    bank_name, bank_account_number, bank_account_name, 
                    is_verified, is_online
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
            `;

            await connection.query(mitraQuery, [
                user_id,
                specializationValue,
                finalCertificateUrl,
                address,
                address_latitude || null,
                address_longitude || null,
                service_radius_km || 10,
                workingDaysValue || '[]',
                working_start || '09:00:00',
                working_end || '17:00:00',
                bank_name || null,
                bank_account_number || null,
                bank_account_name || null
            ]);

            await connection.commit();

            res.status(201).json({
                success: true,
                message: 'Registrasi mitra berhasil',
                data: {
                    user_id: user_id,
                    specialization: specialization,
                    certificate_url: finalCertificateUrl,
                    is_verified: false,
                    is_online: false
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Register Mitra Error:', error);

            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({
                    success: false,
                    message: 'Mitra sudah terdaftar'
                });
            }

            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // Check status registrasi mitra
    checkMitraStatus: async (req, res) => {
        let connection;
        const { user_id } = req.params;

        try {
            connection = await db.getConnection();

            const [userCheck] = await connection.query(
                'SELECT id, role FROM users WHERE id = ? AND role = "mitra"',
                [user_id]
            );

            if (userCheck.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'User mitra tidak ditemukan',
                    data: {
                        is_registered: false,
                        is_verified: false,
                        is_online: false
                    }
                });
            }

            const [mitraData] = await connection.query(
                `SELECT is_verified, is_online, specialization
                 FROM mitra_details WHERE user_id = ?`,
                [user_id]
            );

            if (mitraData.length === 0) {
                return res.json({
                    success: true,
                    data: {
                        is_registered: false,
                        is_verified: false,
                        is_online: false
                    }
                });
            }

            const mitra = mitraData[0];
            let specialization = mitra.specialization;

            if (specialization) {
                try {
                    if (typeof specialization === 'string' && specialization.startsWith('[')) {
                        specialization = JSON.parse(specialization);
                    }
                } catch (e) {
                    console.log('Specialization is not JSON:', specialization);
                }
            }

            res.json({
                success: true,
                data: {
                    is_registered: true,
                    is_verified: mitra.is_verified === 1,
                    is_online: mitra.is_online === 1,
                    specialization: specialization
                }
            });

        } catch (error) {
            console.error('❌ Check Mitra Status Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // Dapatkan detail mitra berdasarkan user_id
    getMitraDetail: async (req, res) => {
        let connection;
        const { user_id } = req.params;

        try {
            connection = await db.getConnection();

            const query = `
                SELECT 
                    u.id, u.name, u.email, u.phone, u.profile_pic,
                    m.specialization, m.certificate_url, m.is_verified,
                    m.is_online, m.address, m.address_latitude, m.address_longitude,
                    m.service_radius_km, m.working_days, m.working_start,
                    m.working_end, m.bank_name, m.bank_account_number, m.bank_account_name,
                    COALESCE(AVG(r.rating), 0) as avg_rating
                FROM users u
                LEFT JOIN mitra_details m ON u.id = m.user_id
                LEFT JOIN reviews r ON m.user_id = r.mitra_id
                WHERE u.id = ? AND u.role = 'mitra'
                GROUP BY u.id
            `;

            const [rows] = await connection.query(query, [user_id]);

            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Mitra tidak ditemukan'
                });
            }

            const data = rows[0];
            if (data.specialization && typeof data.specialization === 'string') {
                try {
                    data.specialization = JSON.parse(data.specialization);
                } catch (e) { }
            }
            if (data.working_days && typeof data.working_days === 'string') {
                try {
                    data.working_days = JSON.parse(data.working_days);
                } catch (e) { }
            }

            res.json({
                success: true,
                data: data
            });

        } catch (error) {
            console.error('❌ Get Mitra Detail Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // Update profil mitra
    updateMitraProfile: async (req, res) => {
        let connection;
        const { user_id } = req.params;
        const {
            specialization, certificate_url, address, address_latitude,
            address_longitude, service_radius_km, working_days,
            working_start, working_end, bank_name,
            bank_account_number, bank_account_name
        } = req.body;

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const [mitraCheck] = await connection.query(
                'SELECT id FROM mitra_details WHERE user_id = ?',
                [user_id]
            );

            if (mitraCheck.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Mitra tidak ditemukan'
                });
            }

            const mitraUpdates = [];
            const mitraValues = [];

            if (specialization !== undefined) {
                const specializationValue = Array.isArray(specialization)
                    ? JSON.stringify(specialization)
                    : specialization;
                mitraUpdates.push('specialization = ?');
                mitraValues.push(specializationValue);
            }
            if (certificate_url !== undefined) {
                mitraUpdates.push('certificate_url = ?');
                mitraValues.push(certificate_url);
            }
            if (address !== undefined) {
                mitraUpdates.push('address = ?');
                mitraValues.push(address);
            }
            if (address_latitude !== undefined) {
                mitraUpdates.push('address_latitude = ?');
                mitraValues.push(address_latitude);
            }
            if (address_longitude !== undefined) {
                mitraUpdates.push('address_longitude = ?');
                mitraValues.push(address_longitude);
            }
            if (service_radius_km !== undefined) {
                mitraUpdates.push('service_radius_km = ?');
                mitraValues.push(service_radius_km);
            }
            if (working_days !== undefined) {
                const workingDaysValue = Array.isArray(working_days)
                    ? JSON.stringify(working_days)
                    : working_days;
                mitraUpdates.push('working_days = ?');
                mitraValues.push(workingDaysValue);
            }
            if (working_start !== undefined) {
                mitraUpdates.push('working_start = ?');
                mitraValues.push(working_start);
            }
            if (working_end !== undefined) {
                mitraUpdates.push('working_end = ?');
                mitraValues.push(working_end);
            }
            if (bank_name !== undefined) {
                mitraUpdates.push('bank_name = ?');
                mitraValues.push(bank_name);
            }
            if (bank_account_number !== undefined) {
                mitraUpdates.push('bank_account_number = ?');
                mitraValues.push(bank_account_number);
            }
            if (bank_account_name !== undefined) {
                mitraUpdates.push('bank_account_name = ?');
                mitraValues.push(bank_account_name);
            }

            if (mitraUpdates.length > 0) {
                mitraValues.push(user_id);
                const mitraQuery = `UPDATE mitra_details SET ${mitraUpdates.join(', ')} WHERE user_id = ?`;
                await connection.query(mitraQuery, mitraValues);
            }

            await connection.commit();

            res.json({
                success: true,
                message: 'Profil mitra berhasil diupdate'
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Update Mitra Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // Update user profile
    updateUserProfile: async (req, res) => {
        let connection;
        const { user_id } = req.params;
        const { name, phone, profile_pic } = req.body;

        try {
            connection = await db.getConnection();

            const updates = [];
            const values = [];

            if (name !== undefined) {
                updates.push('name = ?');
                values.push(name);
            }
            if (phone !== undefined) {
                updates.push('phone = ?');
                values.push(phone);
            }
            if (profile_pic !== undefined) {
                updates.push('profile_pic = ?');
                values.push(profile_pic);
            }

            if (updates.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Tidak ada field yang diupdate'
                });
            }

            values.push(user_id);
            const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ? AND role = 'mitra'`;

            const [result] = await connection.query(query, values);

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'User mitra tidak ditemukan'
                });
            }

            res.json({
                success: true,
                message: 'Profil user berhasil diupdate'
            });

        } catch (error) {
            console.error('❌ Update User Error:', error);
            if (error.code === 'ER_DUP_ENTRY') {
                if (error.sqlMessage.includes('email')) {
                    return res.status(409).json({
                        success: false,
                        message: 'Email sudah terdaftar'
                    });
                }
                if (error.sqlMessage.includes('phone')) {
                    return res.status(409).json({
                        success: false,
                        message: 'Nomor telepon sudah terdaftar'
                    });
                }
            }
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // Toggle online status mitra
    toggleOnlineStatus: async (req, res) => {
        let connection;
        const { user_id } = req.params;

        try {
            connection = await db.getConnection();

            const [currentStatus] = await connection.query(
                'SELECT is_online FROM mitra_details WHERE user_id = ?',
                [user_id]
            );

            if (currentStatus.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Mitra tidak ditemukan'
                });
            }

            const newStatus = currentStatus[0]?.is_online ? 0 : 1;

            await connection.query(
                'UPDATE mitra_details SET is_online = ? WHERE user_id = ?',
                [newStatus, user_id]
            );

            res.json({
                success: true,
                data: { is_online: newStatus === 1 },
                message: newStatus ? 'Anda sekarang online' : 'Anda sekarang offline'
            });

        } catch (error) {
            console.error('❌ Toggle Online Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // Check kelengkapan profil mitra
    checkMitraProfile: async (req, res) => {
        const { user_id } = req.params;

        try {
            const [rows] = await db.execute(
                `SELECT specialization, address, working_days, working_start, 
                 working_end, bank_name, bank_account_number, bank_account_name
                 FROM mitra_details WHERE user_id = ?`,
                [user_id]
            );

            if (rows.length === 0) {
                return res.json({
                    success: true,
                    data: {
                        is_complete: false,
                        missing_fields: ['all']
                    }
                });
            }

            const mitra = rows[0];
            const requiredFields = [
                'specialization', 'address', 'working_days',
                'working_start', 'working_end', 'bank_name',
                'bank_account_number', 'bank_account_name'
            ];

            const missingFields = requiredFields.filter(field => {
                const value = mitra[field];
                return !value ||
                    (typeof value === 'string' && value.trim() === '') ||
                    (Array.isArray(value) && value.length === 0);
            });

            const isComplete = missingFields.length === 0;

            res.json({
                success: true,
                data: {
                    is_complete: isComplete,
                    missing_fields: missingFields
                }
            });

        } catch (error) {
            console.error('❌ Check Mitra Profile Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        }
    },

    // Get all therapists
    getAllTherapists: async (req, res) => {
        let connection;
        const { verified, online } = req.query;

        try {
            connection = await db.getConnection();

            let query = `
                SELECT 
                    u.id, u.name, u.email, u.phone, u.profile_pic,
                    m.specialization, m.is_verified, m.is_online,
                    m.address, m.service_radius_km, COALESCE(AVG(r.rating), 0) as avg_rating
                FROM users u
                JOIN mitra_details m ON u.id = m.user_id
                LEFT JOIN reviews r ON m.user_id = r.mitra_id
                WHERE u.role = 'mitra'
            `;

            const queryParams = [];

            if (verified === 'true') {
                query += ` AND m.is_verified = 1`;
            }

            if (online === 'true') {
                query += ` AND m.is_online = 1`;
            }

            query += ` GROUP BY u.id ORDER BY m.is_online DESC, avg_rating DESC`;

            const [rows] = await connection.query(query, queryParams);

            res.json({
                success: true,
                data: rows,
                count: rows.length
            });

        } catch (error) {
            console.error('❌ Get All Therapists Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // Get therapists by service
    getTherapistsByService: async (req, res) => {
        let connection;
        const { service_id } = req.params;

        try {
            connection = await db.getConnection();

            const query = `
                SELECT 
                    u.id, u.name, u.email, u.phone, u.profile_pic,
                    m.specialization, m.is_verified, m.is_online,
                    m.address, m.service_radius_km, COALESCE(AVG(r.rating), 0) as avg_rating
                FROM users u
                JOIN mitra_details m ON u.id = m.user_id
                LEFT JOIN reviews r ON m.user_id = r.mitra_id
                WHERE u.role = 'mitra' 
                AND m.is_verified = 1 
                AND m.is_online = 1
                AND JSON_SEARCH(m.specialization, 'all', (SELECT service_name FROM services WHERE id = ?)) IS NOT NULL
                GROUP BY u.id
                ORDER BY avg_rating DESC
            `;

            const [rows] = await connection.query(query, [service_id]);

            const therapists = rows.map(therapist => {
                if (typeof therapist.specialization === 'string') {
                    try {
                        therapist.specialization = JSON.parse(therapist.specialization);
                    } catch (e) {
                        therapist.specialization = [therapist.specialization];
                    }
                }
                return therapist;
            });

            res.json({
                success: true,
                data: therapists,
                count: therapists.length
            });

        } catch (error) {
            console.error('❌ Get Therapists By Service Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // Approve mitra registration (Admin only) - DENGAN NOTIFIKASI
    approveMitra: async (req, res) => {
        let connection;
        const { user_id } = req.params;
        const { is_verified, rejection_reason } = req.body;

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // Cek apakah mitra exists dan ambil data user
            const [mitraCheck] = await connection.query(
                `SELECT md.id, md.is_verified, u.name, u.email 
                 FROM mitra_details md 
                 JOIN users u ON md.user_id = u.id 
                 WHERE md.user_id = ?`,
                [user_id]
            );

            if (mitraCheck.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Mitra tidak ditemukan'
                });
            }

            const mitraName = mitraCheck[0].name || 'Mitra';
            const oldStatus = mitraCheck[0].is_verified;

            // Update status verifikasi
            await connection.query(
                'UPDATE mitra_details SET is_verified = ? WHERE user_id = ?',
                [is_verified ? 1 : 0, user_id]
            );

            let notificationSent = false;

            // Cek apakah tabel notifications ada
            const [tableCheck] = await connection.query(
                "SHOW TABLES LIKE 'notifications'"
            );

            if (tableCheck.length === 0) {
                console.warn('⚠️ Tabel notifications belum dibuat, skip insert notifikasi');
            } else {
                // Kirim notifikasi berdasarkan aksi
                if (is_verified && oldStatus === 0) {
                    // Verifikasi mitra
                    await connection.query(
                        `INSERT INTO notifications (user_id, title, message, type, is_read) 
                         VALUES (?, ?, ?, ?, 0)`,
                        [user_id,
                            '✅ Akun Diverifikasi',
                            'Selamat! Akun mitra Anda telah diverifikasi. Anda sekarang dapat mulai menerima pesanan.',
                            'verification']
                    );

                    try {
                        const pushResult = await notificationService.sendVerificationNotification(user_id, mitraName);
                        notificationSent = pushResult.success;
                    } catch (pushError) {
                        console.error('Push notification error:', pushError.message);
                    }

                } else if (!is_verified && oldStatus === 1) {
                    // Pembatalan verifikasi (unverify)
                    const unverifyMessage = rejection_reason
                        ? `Verifikasi akun mitra Anda dibatalkan. Alasan: ${rejection_reason}`
                        : 'Verifikasi akun mitra Anda telah dibatalkan. Silakan hubungi admin untuk informasi lebih lanjut.';

                    await connection.query(
                        `INSERT INTO notifications (user_id, title, message, type, is_read) 
                         VALUES (?, ?, ?, ?, 0)`,
                        [user_id,
                            '⚠️ Verifikasi Dibatalkan',
                            unverifyMessage,
                            'warning']
                    );

                    try {
                        const pushResult = await notificationService.sendUnverificationNotification(user_id, mitraName, rejection_reason);
                        notificationSent = pushResult.success;
                    } catch (pushError) {
                        console.error('Push notification error:', pushError.message);
                    }
                }
            }

            await connection.commit();

            res.json({
                success: true,
                message: is_verified
                    ? 'Mitra berhasil diverifikasi'
                    : 'Verifikasi mitra dibatalkan',
                data: {
                    is_verified,
                    push_notification_sent: notificationSent
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Approve Mitra Error:', error);

            if (error.code === 'ER_NO_SUCH_TABLE') {
                return res.status(500).json({
                    success: false,
                    message: 'Tabel notifikasi belum dibuat. Silakan hubungi administrator.',
                    error_details: 'Missing notifications table'
                });
            }

            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // Get all mitra registrations
    getAllMitraRegistrations: async (req, res) => {
        let connection;
        const { status, search } = req.query;

        try {
            connection = await db.getConnection();

            let query = `
                SELECT 
                    u.id as user_id, u.name, u.email, u.phone, u.profile_pic,
                    u.created_at as user_created_at, m.id as mitra_id,
                    m.specialization, m.certificate_url, m.is_verified,
                    m.address, m.address_latitude, m.address_longitude,
                    m.service_radius_km, m.working_days, m.working_start,
                    m.working_end, m.bank_name, m.bank_account_number,
                    m.bank_account_name, u.created_at as mitra_registered_at,
                    COALESCE(
                        (SELECT JSON_ARRAYAGG(
                            JSON_OBJECT(
                                'id', o.id, 'total_amount', o.total_amount,
                                'status', o.status, 'scheduled_at', o.scheduled_at
                            )
                        ) FROM orders o WHERE o.mitra_id = m.user_id LIMIT 5),
                        JSON_ARRAY()
                    ) as recent_orders,
                    (SELECT COUNT(*) FROM orders WHERE mitra_id = m.user_id) as total_orders,
                    (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE mitra_id = m.user_id) as avg_rating
                FROM users u
                INNER JOIN mitra_details m ON u.id = m.user_id
                WHERE u.role = 'mitra'
            `;

            const queryParams = [];

            if (status === 'pending') {
                query += ` AND m.is_verified = 0`;
            } else if (status === 'verified') {
                query += ` AND m.is_verified = 1`;
            }

            if (search && search.trim() !== '') {
                query += ` AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)`;
                const searchPattern = `%${search.trim()}%`;
                queryParams.push(searchPattern, searchPattern, searchPattern);
            }

            query += ` ORDER BY u.created_at DESC`;

            const [rows] = await connection.query(query, queryParams);

            const registrations = rows.map(row => {
                if (row.specialization && typeof row.specialization === 'string') {
                    try {
                        row.specialization = JSON.parse(row.specialization);
                        if (!Array.isArray(row.specialization)) {
                            row.specialization = [row.specialization];
                        }
                    } catch (e) {
                        row.specialization = [row.specialization];
                    }
                } else if (!row.specialization) {
                    row.specialization = [];
                }

                if (row.working_days && typeof row.working_days === 'string') {
                    try {
                        row.working_days = JSON.parse(row.working_days);
                        if (!Array.isArray(row.working_days)) {
                            row.working_days = [row.working_days];
                        }
                    } catch (e) {
                        row.working_days = [row.working_days];
                    }
                } else if (!row.working_days) {
                    row.working_days = [];
                }

                if (row.recent_orders && typeof row.recent_orders === 'string') {
                    try {
                        row.recent_orders = JSON.parse(row.recent_orders);
                        if (!Array.isArray(row.recent_orders)) {
                            row.recent_orders = [];
                        }
                    } catch (e) {
                        row.recent_orders = [];
                    }
                } else if (!row.recent_orders) {
                    row.recent_orders = [];
                }

                row.total_orders = parseInt(row.total_orders) || 0;
                row.avg_rating = parseFloat(row.avg_rating) || 0;
                row.is_verified = parseInt(row.is_verified) || 0;
                row.service_radius_km = parseInt(row.service_radius_km) || 10;

                return row;
            });

            const stats = {
                total: registrations.length,
                pending: registrations.filter(r => r.is_verified === 0).length,
                verified: registrations.filter(r => r.is_verified === 1).length
            };

            res.json({
                success: true,
                message: 'Data mitra berhasil diambil',
                data: registrations,
                stats: stats,
                filters: {
                    status: status || 'all',
                    search: search || ''
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Get All Mitra Registrations Error:', error);
            let errorMessage = 'Terjadi kesalahan pada server';
            let statusCode = 500;

            if (error.code === 'ER_BAD_FIELD_ERROR') {
                errorMessage = 'Terjadi kesalahan struktur database';
            } else if (error.code === 'ER_PARSE_ERROR') {
                errorMessage = 'Terjadi kesalahan sintaks SQL';
            } else if (error.code === 'ER_NO_SUCH_TABLE') {
                errorMessage = 'Tabel database tidak ditemukan';
            }

            res.status(statusCode).json({
                success: false,
                message: errorMessage,
                error: process.env.NODE_ENV === 'development' ? error.message : undefined,
                code: error.code
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // Get detailed mitra registration by ID
    getMitraRegistrationDetail: async (req, res) => {
        let connection;
        const { user_id } = req.params;

        try {
            connection = await db.getConnection();

            const query = `
                SELECT 
                    u.id as user_id, u.name, u.email, u.phone, u.profile_pic,
                    u.created_at as user_created_at, m.id as mitra_id,
                    m.specialization, m.certificate_url, m.is_verified,
                    m.address, m.address_latitude, m.address_longitude,
                    m.service_radius_km, m.working_days, m.working_start,
                    m.working_end, m.bank_name, m.bank_account_number,
                    m.bank_account_name, u.created_at as mitra_registered_at,
                    (SELECT COUNT(*) FROM orders WHERE mitra_id = m.user_id) as total_orders,
                    (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE mitra_id = m.user_id) as avg_rating
                FROM users u
                INNER JOIN mitra_details m ON u.id = m.user_id
                WHERE u.id = ? AND u.role = 'mitra'
            `;

            const [rows] = await connection.query(query, [user_id]);

            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Data mitra tidak ditemukan'
                });
            }

            const mitra = rows[0];

            if (mitra.specialization && typeof mitra.specialization === 'string') {
                try {
                    mitra.specialization = JSON.parse(mitra.specialization);
                } catch (e) { }
            }
            if (mitra.working_days && typeof mitra.working_days === 'string') {
                try {
                    mitra.working_days = JSON.parse(mitra.working_days);
                } catch (e) { }
            }

            mitra.total_orders = parseInt(mitra.total_orders) || 0;
            mitra.avg_rating = parseFloat(mitra.avg_rating) || 0;

            res.json({
                success: true,
                data: mitra
            });

        } catch (error) {
            console.error('❌ Get Mitra Registration Detail Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // Delete mitra (admin only) - DENGAN NOTIFIKASI
    deleteMitra: async (req, res) => {
        let connection;
        const { user_id } = req.params;

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // Ambil data mitra sebelum dihapus untuk notifikasi
            const [mitraData] = await connection.query(
                `SELECT u.name, u.email, m.is_verified 
                 FROM users u 
                 JOIN mitra_details m ON u.id = m.user_id 
                 WHERE u.id = ?`,
                [user_id]
            );

            if (mitraData.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Mitra tidak ditemukan'
                });
            }

            const mitraName = mitraData[0].name || 'Mitra';

            // Kirim notifikasi sebelum menghapus/disable akun
            const [tableCheck] = await connection.query(
                "SHOW TABLES LIKE 'notifications'"
            );

            if (tableCheck.length > 0) {
                await connection.query(
                    `INSERT INTO notifications (user_id, title, message, type, is_read) 
                     VALUES (?, ?, ?, ?, 0)`,
                    [user_id,
                        '🗑️ Akun Mitra Dinonaktifkan',
                        `Akun mitra Anda telah dinonaktifkan oleh administrator. Akun Anda telah diubah menjadi pelanggan. Silakan hubungi admin untuk informasi lebih lanjut.`,
                        'account_deactivation']
                );

                // Kirim push notification
                try {
                    await notificationService.sendAccountDeactivationNotification(user_id, mitraName);
                } catch (pushError) {
                    console.error('Push notification error:', pushError.message);
                }
            }

            // Soft delete: update status
            await connection.query(
                'UPDATE users SET is_active = 0, role = ? WHERE id = ?',
                ['customer', user_id]
            );

            await connection.query(
                'UPDATE mitra_details SET is_verified = 0, is_online = 0 WHERE user_id = ?',
                [user_id]
            );

            await connection.commit();

            res.json({
                success: true,
                message: 'Mitra berhasil dinonaktifkan',
                data: {
                    user_id: user_id,
                    new_role: 'customer',
                    is_active: false,
                    notification_sent: true
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Delete Mitra Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // Dashboard mitra
    getDashboard: async (req, res) => {
        let connection;
        const { user_id } = req.params;

        try {
            connection = await db.getConnection();

            const [todayOrders] = await connection.query(`
                SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
                FROM orders 
                WHERE mitra_id = ? AND DATE(scheduled_at) = CURDATE()
            `, [user_id]);

            const [monthOrders] = await connection.query(`
                SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
                FROM orders 
                WHERE mitra_id = ? 
                AND MONTH(scheduled_at) = MONTH(CURDATE())
                AND YEAR(scheduled_at) = YEAR(CURDATE())
            `, [user_id]);

            const [pendingOrders] = await connection.query(`
                SELECT COUNT(*) as count
                FROM orders 
                WHERE mitra_id = ? AND status = 'paid'
            `, [user_id]);

            const [ongoingOrders] = await connection.query(`
                SELECT COUNT(*) as count
                FROM orders 
                WHERE mitra_id = ? AND status IN ('accepted', 'otw', 'ongoing')
            `, [user_id]);

            const [rating] = await connection.query(`
                SELECT COALESCE(AVG(rating), 0) as avg_rating
                FROM reviews WHERE mitra_id = ?
            `, [user_id]);

            const [mitraStatus] = await connection.query(`
                SELECT is_online FROM mitra_details WHERE user_id = ?
            `, [user_id]);

            res.json({
                success: true,
                data: {
                    total_orders_today: todayOrders[0]?.count || 0,
                    total_earnings_today: parseInt(todayOrders[0]?.total) || 0,
                    total_orders_month: monthOrders[0]?.count || 0,
                    total_earnings_month: parseInt(monthOrders[0]?.total) || 0,
                    rating: parseFloat(rating[0]?.avg_rating) || 0,
                    pending_orders: pendingOrders[0]?.count || 0,
                    ongoing_orders: ongoingOrders[0]?.count || 0,
                    is_online: mitraStatus[0]?.is_online === 1
                }
            });

        } catch (error) {
            console.error('❌ Get Dashboard Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        } finally {
            if (connection) connection.release();
        }
    }

};

module.exports = mitraController;