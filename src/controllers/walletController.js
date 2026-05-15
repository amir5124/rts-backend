const db = require('../config/db');

// Helper function untuk generate transaction code
const generateTransactionCode = () => {
    const date = new Date();
    const timestamp = date.getTime().toString();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `TRX-${timestamp}-${random}`;
};

const walletController = {
    // 1. Cek Saldo User
    getBalance: async (req, res) => {
        const { user_id } = req.params;

        try {
            const [wallets] = await db.execute(
                `SELECT w.balance, w.pending_balance, w.total_withdrawn, w.total_topup,
                        (SELECT COUNT(*) FROM wallet_transactions WHERE wallet_id = w.id) as total_transactions,
                        u.name, u.role
                 FROM wallets w
                 JOIN users u ON w.user_id = u.id
                 WHERE w.user_id = ?`,
                [user_id]
            );

            if (wallets.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Wallet tidak ditemukan"
                });
            }

            res.json({
                success: true,
                data: {
                    user_id: parseInt(user_id),
                    user_name: wallets[0].name,
                    role: wallets[0].role,
                    balance: parseFloat(wallets[0].balance) || 0,
                    pending_balance: parseFloat(wallets[0].pending_balance) || 0,
                    total_withdrawn: parseFloat(wallets[0].total_withdrawn) || 0,
                    total_topup: parseFloat(wallets[0].total_topup) || 0,
                    total_transactions: wallets[0].total_transactions
                }
            });

        } catch (error) {
            console.error('❌ Get Balance Error:', error);
            res.status(500).json({
                success: false,
                message: "Terjadi kesalahan pada server"
            });
        }
    },

    // 2. Riwayat Transaksi Wallet
    getTransactionHistory: async (req, res) => {
        const { user_id } = req.params;
        const { limit = 20, offset = 0, type = null } = req.query;

        try {
            let query = `
                SELECT wt.*, w.user_id
                FROM wallet_transactions wt
                JOIN wallets w ON wt.wallet_id = w.id
                WHERE w.user_id = ?
            `;
            const params = [user_id];

            if (type && type !== 'all') {
                query += ' AND wt.type = ?';
                params.push(type);
            }

            query += ` ORDER BY wt.created_at DESC LIMIT ? OFFSET ?`;
            params.push(parseInt(limit), parseInt(offset));

            const [transactions] = await db.execute(query, params);

            // Get total count untuk pagination
            let countQuery = `
                SELECT COUNT(*) as total
                FROM wallet_transactions wt
                JOIN wallets w ON wt.wallet_id = w.id
                WHERE w.user_id = ?
            `;
            const countParams = [user_id];

            if (type && type !== 'all') {
                countQuery += ' AND wt.type = ?';
                countParams.push(type);
            }

            const [total] = await db.execute(countQuery, countParams);

            // Format response
            const formattedTransactions = transactions.map(t => ({
                id: t.id,
                transaction_code: t.transaction_code,
                type: t.type,
                amount: parseFloat(t.amount),
                balance_before: parseFloat(t.balance_before),
                balance_after: parseFloat(t.balance_after),
                status: t.status,
                description: t.description,
                reference_id: t.reference_id,
                reference_type: t.reference_type,
                created_at: t.created_at
            }));

            res.json({
                success: true,
                data: {
                    transactions: formattedTransactions,
                    pagination: {
                        total: total[0].total,
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        has_more: offset + transactions.length < total[0].total
                    }
                }
            });

        } catch (error) {
            console.error('❌ Get Transaction History Error:', error);
            res.status(500).json({
                success: false,
                message: "Terjadi kesalahan pada server"
            });
        }
    },

    // 3. Topup Saldo (Customer)
    topupBalance: async (req, res) => {
        const { user_id } = req.params;
        const { amount, payment_method } = req.body;
        let connection;

        try {
            // Validasi
            if (!amount || amount < 10000) {
                return res.status(400).json({
                    success: false,
                    message: "Minimal topup Rp 10.000"
                });
            }

            if (!payment_method) {
                return res.status(400).json({
                    success: false,
                    message: "Metode pembayaran harus dipilih"
                });
            }

            connection = await db.getConnection();
            await connection.beginTransaction();

            // Cek wallet user
            const [wallets] = await connection.execute(
                'SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE',
                [user_id]
            );

            if (wallets.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: "Wallet tidak ditemukan"
                });
            }

            const wallet = wallets[0];
            const balanceBefore = parseFloat(wallet.balance);
            const balanceAfter = balanceBefore + amount;

            // Buat transaksi topup (pending)
            const transactionCode = generateTransactionCode();
            const [transactionResult] = await connection.execute(
                `INSERT INTO wallet_transactions 
                (wallet_id, transaction_code, type, amount, balance_before, balance_after, status, description, reference_type) 
                VALUES (?, ?, 'topup', ?, ?, ?, 'pending', ?, 'topup')`,
                [wallet.id, transactionCode, amount, balanceBefore, balanceAfter, `Topup saldo sebesar Rp ${amount.toLocaleString('id-ID')}`]
            );

            // Buat record topup
            const [topupResult] = await connection.execute(
                `INSERT INTO topups (customer_id, amount, payment_method, status) 
                VALUES (?, ?, ?, 'pending')`,
                [user_id, amount, payment_method]
            );

            // Update transaction dengan reference_id
            await connection.execute(
                'UPDATE wallet_transactions SET reference_id = ? WHERE id = ?',
                [topupResult.insertId, transactionResult.insertId]
            );

            await connection.commit();

            res.json({
                success: true,
                message: "Permintaan topup berhasil, silakan selesaikan pembayaran",
                data: {
                    topup_id: topupResult.insertId,
                    transaction_code: transactionCode,
                    amount: amount,
                    payment_method: payment_method,
                    status: 'pending'
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Topup Error:', error);
            res.status(500).json({
                success: false,
                message: "Terjadi kesalahan pada server"
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 4. Konfirmasi Topup (Callback dari payment gateway)
    confirmTopup: async (req, res) => {
        const { topup_id, payment_code, status } = req.body;
        let connection;

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // Cek topup record
            const [topups] = await connection.execute(
                'SELECT * FROM topups WHERE id = ? FOR UPDATE',
                [topup_id]
            );

            if (topups.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: "Topup tidak ditemukan"
                });
            }

            const topup = topups[0];

            if (topup.status !== 'pending') {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Topup sudah ${topup.status}`
                });
            }

            if (status === 'success') {
                // Update wallet balance
                const [wallets] = await connection.execute(
                    'SELECT id, balance, total_topup FROM wallets WHERE user_id = ? FOR UPDATE',
                    [topup.customer_id]
                );

                const wallet = wallets[0];
                const balanceBefore = parseFloat(wallet.balance);
                const balanceAfter = balanceBefore + topup.amount;
                const totalTopup = parseFloat(wallet.total_topup) + topup.amount;

                // Update wallet
                await connection.execute(
                    'UPDATE wallets SET balance = ?, total_topup = ? WHERE user_id = ?',
                    [balanceAfter, totalTopup, topup.customer_id]
                );

                // Update transaction status
                await connection.execute(
                    `UPDATE wallet_transactions 
                     SET status = 'success', updated_at = NOW() 
                     WHERE reference_id = ? AND type = 'topup'`,
                    [topup_id]
                );
            }

            // Update topup record
            await connection.execute(
                `UPDATE topups 
                 SET status = ?, payment_code = ?, paid_at = NOW() 
                 WHERE id = ?`,
                [status, payment_code || null, topup_id]
            );

            await connection.commit();

            res.json({
                success: true,
                message: status === 'success' ? "Topup berhasil" : "Topup gagal",
                data: { status }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Confirm Topup Error:', error);
            res.status(500).json({
                success: false,
                message: "Terjadi kesalahan pada server"
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 5. Request Withdraw (Mitra)
    requestWithdraw: async (req, res) => {
        const { user_id } = req.params;
        const { amount, bank_name, bank_account_number, bank_account_name } = req.body;
        let connection;

        try {
            // Validasi
            if (!amount || amount < 50000) {
                return res.status(400).json({
                    success: false,
                    message: "Minimal penarikan Rp 50.000"
                });
            }

            connection = await db.getConnection();
            await connection.beginTransaction();

            // Cek wallet user
            const [wallets] = await connection.execute(
                'SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE',
                [user_id]
            );

            if (wallets.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: "Wallet tidak ditemukan"
                });
            }

            const wallet = wallets[0];
            const currentBalance = parseFloat(wallet.balance);

            if (currentBalance < amount) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: "Saldo tidak mencukupi"
                });
            }

            const balanceBefore = currentBalance;
            const balanceAfter = balanceBefore - amount;

            // Buat transaksi withdraw (pending)
            const transactionCode = generateTransactionCode();
            await connection.execute(
                `INSERT INTO wallet_transactions 
                (wallet_id, transaction_code, type, amount, balance_before, balance_after, status, description, reference_type) 
                VALUES (?, ?, 'withdraw', ?, ?, ?, 'pending', ?, 'withdrawal')`,
                [wallet.id, transactionCode, amount, balanceBefore, balanceAfter, `Penarikan dana sebesar Rp ${amount.toLocaleString('id-ID')}`]
            );

            // Update wallet balance (pending)
            await connection.execute(
                'UPDATE wallets SET balance = ?, pending_balance = pending_balance + ? WHERE user_id = ?',
                [balanceAfter, amount, user_id]
            );

            // Buat record withdrawal
            const [withdrawResult] = await connection.execute(
                `INSERT INTO withdrawals 
                (mitra_id, amount, bank_name, bank_account_number, bank_account_name, status) 
                VALUES (?, ?, ?, ?, ?, 'pending')`,
                [user_id, amount, bank_name, bank_account_number, bank_account_name]
            );

            await connection.commit();

            res.json({
                success: true,
                message: "Permintaan penarikan dana berhasil diajukan",
                data: {
                    withdrawal_id: withdrawResult.insertId,
                    amount: amount,
                    status: 'pending'
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Withdraw Error:', error);
            res.status(500).json({
                success: false,
                message: "Terjadi kesalahan pada server"
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 6. Konfirmasi Withdraw (Admin)
    confirmWithdraw: async (req, res) => {
        const { withdrawal_id, status, notes } = req.body;
        let connection;

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // Cek withdrawal record
            const [withdrawals] = await connection.execute(
                'SELECT * FROM withdrawals WHERE id = ? FOR UPDATE',
                [withdrawal_id]
            );

            if (withdrawals.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: "Withdrawal tidak ditemukan"
                });
            }

            const withdrawal = withdrawals[0];

            if (withdrawal.status !== 'pending') {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Withdrawal sudah ${withdrawal.status}`
                });
            }

            if (status === 'completed') {
                // Update transaction status
                await connection.execute(
                    `UPDATE wallet_transactions 
                     SET status = 'success', updated_at = NOW() 
                     WHERE reference_id = ? AND type = 'withdraw'`,
                    [withdrawal_id]
                );

                // Update pending_balance
                await connection.execute(
                    'UPDATE wallets SET pending_balance = pending_balance - ? WHERE user_id = ?',
                    [withdrawal.amount, withdrawal.mitra_id]
                );

                // Update total_withdrawn
                await connection.execute(
                    'UPDATE wallets SET total_withdrawn = total_withdrawn + ? WHERE user_id = ?',
                    [withdrawal.amount, withdrawal.mitra_id]
                );
            } else if (status === 'failed' || status === 'cancelled') {
                // Refund balance
                await connection.execute(
                    'UPDATE wallets SET balance = balance + ? WHERE user_id = ?',
                    [withdrawal.amount, withdrawal.mitra_id]
                );

                // Update transaction status
                await connection.execute(
                    `UPDATE wallet_transactions 
                     SET status = 'failed', updated_at = NOW() 
                     WHERE reference_id = ? AND type = 'withdraw'`,
                    [withdrawal_id]
                );
            }

            // Update withdrawal record
            await connection.execute(
                `UPDATE withdrawals 
                 SET status = ?, notes = ?, processed_at = NOW(), 
                     completed_at = ${status === 'completed' ? 'NOW()' : 'NULL'}
                 WHERE id = ?`,
                [status, notes || null, withdrawal_id]
            );

            await connection.commit();

            res.json({
                success: true,
                message: status === 'completed' ? "Withdrawal berhasil diproses" : "Withdrawal dibatalkan"
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Confirm Withdraw Error:', error);
            res.status(500).json({
                success: false,
                message: "Terjadi kesalahan pada server"
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 7. Transfer Saldo (Customer ke Customer atau Customer ke Mitra)
    transferBalance: async (req, res) => {
        const { from_user_id } = req.params;
        const { to_user_id, amount, description } = req.body;
        let connection;

        try {
            // Validasi
            if (!to_user_id || !amount || amount < 1000) {
                return res.status(400).json({
                    success: false,
                    message: "Minimal transfer Rp 1.000"
                });
            }

            if (from_user_id === to_user_id) {
                return res.status(400).json({
                    success: false,
                    message: "Tidak dapat transfer ke diri sendiri"
                });
            }

            connection = await db.getConnection();
            await connection.beginTransaction();

            // Cek wallet pengirim
            const [fromWallets] = await connection.execute(
                'SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE',
                [from_user_id]
            );

            if (fromWallets.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: "Wallet pengirim tidak ditemukan"
                });
            }

            const fromWallet = fromWallets[0];
            const fromBalance = parseFloat(fromWallet.balance);

            if (fromBalance < amount) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: "Saldo tidak mencukupi"
                });
            }

            // Cek wallet penerima
            const [toWallets] = await connection.execute(
                'SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE',
                [to_user_id]
            );

            if (toWallets.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: "Wallet penerima tidak ditemukan"
                });
            }

            const toWallet = toWallets[0];
            const toBalanceBefore = parseFloat(toWallet.balance);
            const toBalanceAfter = toBalanceBefore + amount;

            // Proses transfer
            const fromBalanceBefore = fromBalance;
            const fromBalanceAfter = fromBalanceBefore - amount;

            // Transaksi keluar (pengirim)
            const outTransactionCode = generateTransactionCode();
            await connection.execute(
                `INSERT INTO wallet_transactions 
                (wallet_id, transaction_code, type, amount, balance_before, balance_after, status, description, reference_type, reference_id) 
                VALUES (?, ?, 'transfer', ?, ?, ?, 'success', ?, 'user', ?)`,
                [fromWallet.id, outTransactionCode, -amount, fromBalanceBefore, fromBalanceAfter,
                description || `Transfer ke user ID ${to_user_id}`, to_user_id]
            );

            // Transaksi masuk (penerima)
            const inTransactionCode = generateTransactionCode();
            await connection.execute(
                `INSERT INTO wallet_transactions 
                (wallet_id, transaction_code, type, amount, balance_before, balance_after, status, description, reference_type, reference_id) 
                VALUES (?, ?, 'transfer', ?, ?, ?, 'success', ?, 'user', ?)`,
                [toWallet.id, inTransactionCode, amount, toBalanceBefore, toBalanceAfter,
                description || `Transfer dari user ID ${from_user_id}`, from_user_id]
            );

            // Update balance
            await connection.execute(
                'UPDATE wallets SET balance = ? WHERE user_id = ?',
                [fromBalanceAfter, from_user_id]
            );
            await connection.execute(
                'UPDATE wallets SET balance = ? WHERE user_id = ?',
                [toBalanceAfter, to_user_id]
            );

            await connection.commit();

            res.json({
                success: true,
                message: "Transfer berhasil",
                data: {
                    from_balance: fromBalanceAfter,
                    to_user_id: to_user_id,
                    amount: amount
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Transfer Error:', error);
            res.status(500).json({
                success: false,
                message: "Terjadi kesalahan pada server"
            });
        } finally {
            if (connection) connection.release();
        }
    }
};

module.exports = walletController;