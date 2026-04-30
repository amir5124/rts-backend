const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.register = async (req, res) => {
    const { name, email, phone, password, role } = req.body;
    const profile_pic = req.file ? req.file.path : null;

    try {
        // 1. Cek apakah email sudah terdaftar
        const [existingUser] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: "Email sudah digunakan" });
        }

        // 2. Hash Password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 3. Simpan User Baru
        const [result] = await db.execute(
            'INSERT INTO users (name, email, phone, password, profile_pic, role) VALUES (?, ?, ?, ?, ?, ?)',
            [name, email, phone, hashedPassword, profile_pic, role || 'customer']
        );

        // 4. Jika role-nya Mitra, buatkan wallet otomatis
        if (role === 'mitra') {
            await db.execute('INSERT INTO mitra_wallets (mitra_id) VALUES (?)', [result.insertId]);
        }

        const token = jwt.sign(
            { id: result.insertId, role: role || 'customer' },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.status(201).json({
            status: true,
            message: "Registrasi berhasil",
            token, 
            user: {
                id: result.insertId,
                name: name,
                role: role || 'customer'
            }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Cari user berdasarkan email
        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(404).json({ message: "User tidak ditemukan" });
        }

        const user = users[0];

        // 2. Cek Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: "Password salah" });
        }

        // 3. Buat JWT Token
        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        // 4. Response (Hilangkan password demi keamanan)
        res.json({
            status: true,
            message: "Login berhasil",
            token,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                photo: user.profile_pic
            }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};