const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Helper function untuk generate transaction code
const generateTransactionCode = () => {
    const date = new Date();
    const timestamp = date.getTime().toString();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `TRX-${timestamp}-${random}`;
};

// Helper function untuk membuat wallet dan transaksi awal
const createWalletAndTransaction = async (userId, connection) => {
    try {
        // 1. Buat wallet
        const [walletResult] = await connection.execute(
            'INSERT INTO wallets (user_id, balance) VALUES (?, 0)',
            [userId]
        );

        const walletId = walletResult.insertId;

        // 2. Buat transaksi awal (selamat datang)
        const transactionCode = generateTransactionCode();
        await connection.execute(
            `INSERT INTO wallet_transactions 
            (wallet_id, transaction_code, type, amount, balance_before, balance_after, status, description) 
            VALUES (?, ?, 'commission', 0, 0, 0, 'success', 'Selamat datang di dompet digital RTS')`,
            [walletId, transactionCode]
        );

        return walletId;
    } catch (error) {
        throw error;
    }
};

exports.register = async (req, res) => {
    const { name, email, phone, password, role } = req.body;
    const profile_pic = req.file ? req.file.path : null;

    let connection;

    try {
        // Mulai koneksi dan transaction
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Cek apakah email sudah terdaftar
        const [existingUser] = await connection.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                status: false,
                message: "Email sudah digunakan"
            });
        }

        // 2. Cek nomor telepon
        const [existingPhone] = await connection.execute('SELECT id FROM users WHERE phone = ?', [phone]);
        if (existingPhone.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                status: false,
                message: "Nomor telepon sudah digunakan"
            });
        }

        // 3. Hash Password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 4. Simpan User Baru
        const userRole = role || 'customer';
        const [result] = await connection.execute(
            'INSERT INTO users (name, email, phone, password, profile_pic, role) VALUES (?, ?, ?, ?, ?, ?)',
            [name, email, phone, hashedPassword, profile_pic, userRole]
        );

        const userId = result.insertId;

        // 5. Buatkan wallet untuk SEMUA user (customer & mitra)
        await createWalletAndTransaction(userId, connection);

        // 6. Commit transaction
        await connection.commit();

        // 7. Buat token
        const token = jwt.sign(
            { id: userId, role: userRole },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.status(201).json({
            status: true,
            message: "Registrasi berhasil",
            token,
            user: {
                id: userId,
                name: name,
                email: email,
                phone: phone,
                role: userRole,
                profile_pic: profile_pic
            }
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Register Error:', err);
        res.status(500).json({
            status: false,
            message: "Terjadi kesalahan pada server"
        });
    } finally {
        if (connection) connection.release();
    }
};

exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Cari user berdasarkan email
        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(404).json({
                status: false,
                message: "Email tidak ditemukan"
            });
        }

        const user = users[0];

        // 2. Cek apakah user aktif
        if (!user.is_active) {
            return res.status(403).json({
                status: false,
                message: "Akun Anda telah dinonaktifkan"
            });
        }

        // 3. Cek Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                status: false,
                message: "Password salah"
            });
        }

        // 4. Ambil informasi wallet
        const [wallets] = await db.execute(
            'SELECT balance, pending_balance FROM wallets WHERE user_id = ?',
            [user.id]
        );

        const wallet = wallets[0] || { balance: 0, pending_balance: 0 };

        // 5. Buat JWT Token — role tetap disertakan di token,
        //    dipakai frontend untuk menentukan tampilan, bukan untuk blokir login
        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        // 6. Response
        res.json({
            status: true,
            message: "Login berhasil",
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                profile_pic: user.profile_pic,
                wallet: {
                    balance: parseFloat(wallet.balance) || 0,
                    pending_balance: parseFloat(wallet.pending_balance) || 0
                }
            }
        });

    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({
            status: false,
            message: "Terjadi kesalahan pada server"
        });
    }
};

exports.logout = async (req, res) => {
    try {
        res.status(200).json({
            status: true,
            message: "Logout berhasil"
        });
    } catch (err) {
        res.status(500).json({
            status: false,
            message: err.message
        });
    }
};

// Fungsi tambahan untuk topup saldo
exports.topupBalance = async (req, res) => {
    const { user_id } = req.params;
    const { amount, payment_method } = req.body;
    let connection;

    try {
        if (!amount || amount < 10000) {
            return res.status(400).json({
                status: false,
                message: "Minimal topup Rp 10.000"
            });
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Cek wallet user
        const [wallets] = await connection.execute(
            'SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE',
            [user_id]
        );

        if (wallets.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: false,
                message: "Wallet tidak ditemukan"
            });
        }

        const wallet = wallets[0];
        const balanceBefore = parseFloat(wallet.balance);
        const balanceAfter = balanceBefore + amount;

        // 2. Buat transaksi topup
        const transactionCode = generateTransactionCode();
        await connection.execute(
            `INSERT INTO wallet_transactions 
            (wallet_id, transaction_code, type, amount, balance_before, balance_after, status, description) 
            VALUES (?, ?, 'topup', ?, ?, ?, 'pending', ?)`,
            [wallet.id, transactionCode, amount, balanceBefore, balanceAfter, `Topup saldo sebesar Rp ${amount.toLocaleString('id-ID')}`]
        );

        // 3. Buat record topup
        const [topupResult] = await connection.execute(
            `INSERT INTO topups (customer_id, amount, payment_method, status) 
            VALUES (?, ?, ?, 'pending')`,
            [user_id, amount, payment_method]
        );

        await connection.commit();

        res.json({
            status: true,
            message: "Permintaan topup berhasil, silakan selesaikan pembayaran",
            data: {
                topup_id: topupResult.insertId,
                transaction_code: transactionCode,
                amount: amount,
                payment_method: payment_method
            }
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Topup Error:', error);
        res.status(500).json({
            status: false,
            message: "Terjadi kesalahan pada server"
        });
    } finally {
        if (connection) connection.release();
    }
};

// Fungsi untuk cek saldo
exports.getBalance = async (req, res) => {
    const { user_id } = req.params;

    try {
        const [wallets] = await db.execute(
            `SELECT w.balance, w.pending_balance, w.total_withdrawn, w.total_topup,
                    (SELECT COUNT(*) FROM wallet_transactions WHERE wallet_id = w.id) as total_transactions
             FROM wallets w 
             WHERE w.user_id = ?`,
            [user_id]
        );

        if (wallets.length === 0) {
            return res.status(404).json({
                status: false,
                message: "Wallet tidak ditemukan"
            });
        }

        res.json({
            status: true,
            data: {
                balance: parseFloat(wallets[0].balance),
                pending_balance: parseFloat(wallets[0].pending_balance),
                total_withdrawn: parseFloat(wallets[0].total_withdrawn),
                total_topup: parseFloat(wallets[0].total_topup),
                total_transactions: wallets[0].total_transactions
            }
        });

    } catch (error) {
        console.error('Get Balance Error:', error);
        res.status(500).json({
            status: false,
            message: "Terjadi kesalahan pada server"
        });
    }
};

// Fungsi untuk riwayat transaksi
exports.getTransactionHistory = async (req, res) => {
    const { user_id } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    try {
        const [transactions] = await db.execute(
            `SELECT wt.*, u.name as reference_name
             FROM wallet_transactions wt
             JOIN wallets w ON wt.wallet_id = w.id
             LEFT JOIN users u ON wt.reference_id = u.id
             WHERE w.user_id = ?
             ORDER BY wt.created_at DESC
             LIMIT ? OFFSET ?`,
            [user_id, parseInt(limit), parseInt(offset)]
        );

        const [total] = await db.execute(
            `SELECT COUNT(*) as total
             FROM wallet_transactions wt
             JOIN wallets w ON wt.wallet_id = w.id
             WHERE w.user_id = ?`,
            [user_id]
        );

        res.json({
            status: true,
            data: {
                transactions: transactions,
                pagination: {
                    total: total[0].total,
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                }
            }
        });

    } catch (error) {
        console.error('Get Transaction History Error:', error);
        res.status(500).json({
            status: false,
            message: "Terjadi kesalahan pada server"
        });
    }
};