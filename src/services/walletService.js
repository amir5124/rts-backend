// services/walletService.js
const db = require('../config/db');

const MITRA_SHARE = 0.80; // 80% ke mitra
const PLATFORM_SHARE = 0.20; // 20% ke platform

const walletService = {

    creditMitraEarning: async (mitraId, orderId, orderCode, totalAmount, connection) => {

        // ✅ Cegah double credit
        const [existing] = await connection.query(
            `SELECT id FROM wallet_transactions 
             WHERE reference_id = ? AND reference_type = 'order' AND type = 'commission'`,
            [orderId]
        );

        if (existing.length > 0) {
            console.log(`⚠️ Earning order #${orderCode} sudah dikreditkan sebelumnya, skip.`);
            return null;
        }

        const mitraEarning = parseFloat((totalAmount * MITRA_SHARE).toFixed(2));
        const platformFee = parseFloat((totalAmount * PLATFORM_SHARE).toFixed(2));

        console.log(`💰 Total: Rp ${totalAmount} → Mitra: Rp ${mitraEarning} (80%) | Platform: Rp ${platformFee} (20%)`);

        // ✅ Ambil atau buat wallet mitra (FOR UPDATE untuk lock row)
        let [walletRows] = await connection.query(
            'SELECT * FROM wallets WHERE user_id = ? FOR UPDATE',
            [mitraId]
        );

        if (walletRows.length === 0) {
            // Auto-create wallet jika belum ada
            await connection.query(
                `INSERT INTO wallets (user_id, balance, pending_balance, total_withdrawn, total_topup) 
                 VALUES (?, 0, 0, 0, 0)`,
                [mitraId]
            );
            [walletRows] = await connection.query(
                'SELECT * FROM wallets WHERE user_id = ? FOR UPDATE',
                [mitraId]
            );
        }

        const wallet = walletRows[0];
        const balanceBefore = parseFloat(wallet.balance);
        const balanceAfter = parseFloat((balanceBefore + mitraEarning).toFixed(2));

        // ✅ Update balance wallet mitra
        await connection.query(
            `UPDATE wallets 
             SET balance = ?, updated_at = NOW()
             WHERE user_id = ?`,
            [balanceAfter, mitraId]
        );

        // ✅ Catat di wallet_transactions
        const transactionCode = `TRX-EARN-${orderId}-${Date.now()}`;

        await connection.query(
            `INSERT INTO wallet_transactions 
                (wallet_id, transaction_code, type, amount, balance_before, balance_after,
                 status, description, reference_id, reference_type)
             VALUES (?, ?, 'commission', ?, ?, ?, 'success', ?, ?, 'order')`,
            [
                wallet.id,
                transactionCode,
                mitraEarning,
                balanceBefore,
                balanceAfter,
                `Pendapatan order #${orderCode} | 80% dari Rp ${Number(totalAmount).toLocaleString('id-ID')}`,
                orderId
            ]
        );

        // ✅ Simpan escrow_amount di orders (80% = bagian mitra)
        await connection.query(
            `UPDATE orders SET escrow_amount = ? WHERE id = ?`,
            [mitraEarning, orderId]
        );

        console.log(`✅ Wallet mitra ${mitraId}: Rp ${balanceBefore} → Rp ${balanceAfter}`);

        return {
            mitraEarning,
            platformFee,
            balanceBefore,
            balanceAfter,
            transactionCode
        };
    }
};

module.exports = walletService;