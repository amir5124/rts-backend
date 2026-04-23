const db = require('../config/db');

const User = {
    // Create
    create: async (data) => {
        const { name, email, phone, password, profile_pic, role } = data;
        const query = 'INSERT INTO users (name, email, phone, password, profile_pic, role) VALUES (?, ?, ?, ?, ?, ?)';
        return db.execute(query, [name, email, phone, password, profile_pic, role]);
    },

    // Read All
    findAll: async () => {
        return db.execute('SELECT id, name, email, phone, profile_pic, role, is_active, created_at FROM users');
    },

    // Read One by ID
    findById: async (id) => {
        const [rows] = await db.execute('SELECT id, name, email, phone, profile_pic, role, is_active FROM users WHERE id = ?', [id]);
        return rows[0];
    },

    // Update
    update: async (id, data) => {
        const { name, email, phone, profile_pic } = data;
        const query = 'UPDATE users SET name = ?, email = ?, phone = ?, profile_pic = ? WHERE id = ?';
        return db.execute(query, [name, email, phone, profile_pic, id]);
    },

    // Delete (Soft Delete atau Hard Delete)
    delete: async (id) => {
        return db.execute('DELETE FROM users WHERE id = ?', [id]);
    }
};

module.exports = User;