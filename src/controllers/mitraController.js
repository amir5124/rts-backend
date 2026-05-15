const db = require('../config/db');

const mitraController = {
    // Registrasi Mitra Baru (User + Mitra Details)
    registerMitra: async (req, res) => {
        let connection;

        try {
            const {
                name,
                email,
                phone,
                password,
                specialization,
                certificate_url,
                address,
                service_radius_km,
                working_days,
                working_start,
                working_end,
                bank_name,
                bank_account_number,
                bank_account_name
            } = req.body;

            // Validasi required fields
            if (!name || !email || !phone || !password || !specialization || !address) {
                return res.status(400).json({
                    success: false,
                    message: 'Field wajib tidak boleh kosong'
                });
            }

            // Validasi role: hanya mitra yang bisa register lewat endpoint ini
            connection = await db.getConnection();
            await connection.beginTransaction();

            // 1. Insert ke tabel users
            const hashedPassword = password; // TODO: Hash password dengan bcrypt
            const userQuery = `
                INSERT INTO users (name, email, phone, password, role, is_active)
                VALUES (?, ?, ?, ?, 'mitra', 1)
            `;

            const [userResult] = await connection.query(userQuery, [
                name, email, phone, hashedPassword
            ]);

            const userId = userResult.insertId;

            // 2. Insert ke tabel mitra_details
            const mitraQuery = `
                INSERT INTO mitra_details (
                    user_id, specialization, certificate_url, address,
                    service_radius_km, working_days, working_start, working_end,
                    bank_name, bank_account_number, bank_account_name, is_verified, is_online
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
            `;

            await connection.query(mitraQuery, [
                userId,
                specialization,
                certificate_url || null,
                address,
                service_radius_km || 10,
                working_days || '[]',
                working_start || '09:00',
                working_end || '17:00',
                bank_name || null,
                bank_account_number || null,
                bank_account_name || null
            ]);

            await connection.commit();

            res.status(201).json({
                success: true,
                message: 'Registrasi mitra berhasil',
                data: {
                    user: {
                        id: userId,
                        name,
                        email,
                        phone,
                        role: 'mitra'
                    }
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Register Mitra Error:', error);

            // Handle duplicate entry
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

    // Dapatkan detail mitra berdasarkan user_id
    getMitraDetail: async (req, res) => {
        let connection;
        const { user_id } = req.params;

        try {
            connection = await db.getConnection();

            const query = `
                SELECT 
                    u.id,
                    u.name,
                    u.email,
                    u.phone,
                    u.profile_pic,
                    m.specialization,
                    m.certificate_url,
                    m.is_verified,
                    m.is_online,
                    m.address,
                    m.service_radius_km,
                    m.working_days,
                    m.working_start,
                    m.working_end,
                    m.bank_name,
                    m.bank_account_number,
                    m.bank_account_name,
                    m.avg_rating
                FROM users u
                LEFT JOIN mitra_details m ON u.id = m.user_id
                WHERE u.id = ? AND u.role = 'mitra'
            `;

            const [rows] = await connection.query(query, [user_id]);

            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Mitra tidak ditemukan'
                });
            }

            res.json({
                success: true,
                data: rows[0]
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
            name,
            phone,
            specialization,
            certificate_url,
            address,
            service_radius_km,
            working_days,
            working_start,
            working_end,
            bank_name,
            bank_account_number,
            bank_account_name
        } = req.body;

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // Update users
            if (name || phone) {
                const userUpdates = [];
                const userValues = [];

                if (name) {
                    userUpdates.push('name = ?');
                    userValues.push(name);
                }
                if (phone) {
                    userUpdates.push('phone = ?');
                    userValues.push(phone);
                }

                if (userUpdates.length > 0) {
                    userValues.push(user_id);
                    const userQuery = `UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?`;
                    await connection.query(userQuery, userValues);
                }
            }

            // Update mitra_details
            const mitraUpdates = [];
            const mitraValues = [];

            if (specialization) {
                mitraUpdates.push('specialization = ?');
                mitraValues.push(specialization);
            }
            if (certificate_url !== undefined) {
                mitraUpdates.push('certificate_url = ?');
                mitraValues.push(certificate_url);
            }
            if (address) {
                mitraUpdates.push('address = ?');
                mitraValues.push(address);
            }
            if (service_radius_km) {
                mitraUpdates.push('service_radius_km = ?');
                mitraValues.push(service_radius_km);
            }
            if (working_days) {
                mitraUpdates.push('working_days = ?');
                mitraValues.push(working_days);
            }
            if (working_start) {
                mitraUpdates.push('working_start = ?');
                mitraValues.push(working_start);
            }
            if (working_end) {
                mitraUpdates.push('working_end = ?');
                mitraValues.push(working_end);
            }
            if (bank_name) {
                mitraUpdates.push('bank_name = ?');
                mitraValues.push(bank_name);
            }
            if (bank_account_number) {
                mitraUpdates.push('bank_account_number = ?');
                mitraValues.push(bank_account_number);
            }
            if (bank_account_name) {
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

    // Di mitraController.js
    checkMitraProfile: async (req, res) => {
        const { user_id } = req.params;

        try {
            const [rows] = await db.execute(
                `SELECT 
                id, specialization, address, working_days, 
                working_start, working_end, bank_name, 
                bank_account_number, bank_account_name
             FROM mitra_details 
             WHERE user_id = ?`,
                [user_id]
            );

            if (rows.length === 0) {
                return res.json({
                    success: true,
                    data: { is_complete: false, missing_fields: ['all'] }
                });
            }

            const mitra = rows[0];

            // Cek field yang wajib diisi
            const requiredFields = [
                'specialization', 'address', 'working_days',
                'working_start', 'working_end', 'bank_name',
                'bank_account_number', 'bank_account_name'
            ];

            const missingFields = requiredFields.filter(field => {
                const value = mitra[field];
                return !value || (typeof value === 'string' && value.trim() === '') ||
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
            console.error('Check Mitra Profile Error:', error);
            res.status(500).json({
                success: false,
                message: 'Terjadi kesalahan pada server'
            });
        }
    },

    // Dashboard mitra
    getDashboard: async (req, res) => {
        let connection;
        const { user_id } = req.params;

        try {
            connection = await db.getConnection();

            // Get today's orders
            const [todayOrders] = await connection.query(`
                SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
                FROM orders 
                WHERE mitra_id = ? 
                AND DATE(scheduled_at) = CURDATE()
            `, [user_id]);

            // Get monthly orders
            const [monthOrders] = await connection.query(`
                SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
                FROM orders 
                WHERE mitra_id = ? 
                AND MONTH(scheduled_at) = MONTH(CURDATE())
                AND YEAR(scheduled_at) = YEAR(CURDATE())
            `, [user_id]);

            // Get pending orders
            const [pendingOrders] = await connection.query(`
                SELECT COUNT(*) as count
                FROM orders 
                WHERE mitra_id = ? AND status = 'paid'
            `, [user_id]);

            // Get ongoing orders
            const [ongoingOrders] = await connection.query(`
                SELECT COUNT(*) as count
                FROM orders 
                WHERE mitra_id = ? AND status IN ('accepted', 'otw', 'ongoing')
            `, [user_id]);

            // Get mitra rating
            const [rating] = await connection.query(`
                SELECT COALESCE(AVG(rating), 0) as avg_rating
                FROM reviews 
                WHERE mitra_id = ?
            `, [user_id]);

            // Get online status
            const [mitraStatus] = await connection.query(`
                SELECT is_online FROM mitra_details WHERE user_id = ?
            `, [user_id]);

            res.json({
                success: true,
                data: {
                    total_orders_today: todayOrders[0]?.count || 0,
                    total_earnings_today: todayOrders[0]?.total || 0,
                    total_orders_month: monthOrders[0]?.count || 0,
                    total_earnings_month: monthOrders[0]?.total || 0,
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