const db = require('../config/db');

const User = {
    // Ambil semua user
    findAll: async () => {
        const query = `
            SELECT 
                u.id, 
                u.name, 
                u.email, 
                u.phone, 
                u.profile_pic, 
                u.role, 
                u.is_active, 
                u.created_at,
                COALESCE((
                    SELECT COUNT(*) FROM orders WHERE customer_id = u.id
                ), 0) as total_orders_as_customer,
                COALESCE((
                    SELECT COUNT(*) FROM orders WHERE mitra_id = u.id
                ), 0) as total_orders_as_mitra
            FROM users u
            ORDER BY u.created_at DESC
        `;
        const [rows] = await db.query(query);

        // Tambahkan total_orders berdasarkan role
        return rows.map(row => ({
            ...row,
            total_orders: row.role === 'mitra' ? row.total_orders_as_mitra : row.total_orders_as_customer
        }));
    },

    // Ambil user berdasarkan ID
    findById: async (id) => {
        const query = `
            SELECT 
                u.id, 
                u.name, 
                u.email, 
                u.phone, 
                u.profile_pic, 
                u.role, 
                u.password,
                u.is_active, 
                u.created_at,
                COALESCE((
                    SELECT COUNT(*) FROM orders WHERE customer_id = u.id
                ), 0) as total_orders_as_customer,
                COALESCE((
                    SELECT COUNT(*) FROM orders WHERE mitra_id = u.id
                ), 0) as total_orders_as_mitra
            FROM users u
            WHERE u.id = ?
        `;
        const [rows] = await db.query(query, [id]);

        if (rows.length === 0) return null;

        const user = rows[0];
        user.total_orders = user.role === 'mitra' ? user.total_orders_as_mitra : user.total_orders_as_customer;

        return user;
    },

    // Update user
    update: async (id, data) => {
        const { name, email, phone, profile_pic } = data;
        const query = `
            UPDATE users 
            SET name = ?, email = ?, phone = ?, profile_pic = ?
            WHERE id = ?
        `;
        const [result] = await db.query(query, [name, email, phone, profile_pic, id]);
        return result;
    },

    // Update password
    updatePassword: async (id, hashedPassword) => {
        const query = `UPDATE users SET password = ? WHERE id = ?`;
        const [result] = await db.query(query, [hashedPassword, id]);
        return result;
    },

    // Update status aktif/nonaktif user
    updateStatus: async (id, isActive) => {
        const query = `UPDATE users SET is_active = ? WHERE id = ?`;
        const [result] = await db.query(query, [isActive ? 1 : 0, id]);
        return result;
    },

    // Delete user
    delete: async (id) => {
        // Hapus data terkait terlebih dahulu
        await db.query('DELETE FROM user_devices WHERE user_id = ?', [id]);
        await db.query('DELETE FROM notifications WHERE user_id = ?', [id]);
        await db.query('DELETE FROM mitra_details WHERE user_id = ?', [id]);

        const query = `DELETE FROM users WHERE id = ?`;
        const [result] = await db.query(query, [id]);
        return result;
    },

    // Get user statistics
    getStatistics: async () => {
        const [result] = await db.query(`
            SELECT 
                COUNT(*) as total_users,
                SUM(CASE WHEN role = 'customer' THEN 1 ELSE 0 END) as total_customers,
                SUM(CASE WHEN role = 'mitra' THEN 1 ELSE 0 END) as total_mitras,
                SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as total_admins,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_users,
                SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive_users
            FROM users
        `);
        return result[0];
    }
};

module.exports = User;