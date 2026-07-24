// cron/escrowRelease.js
const cron = require('node-cron');
const EscrowService = require('../services/escrowService');

/**
 * Cron Job: Jalankan setiap 5 menit
 * Untuk mengecek dan mengeksekusi auto-release escrow
 */
const startEscrowCron = () => {
    console.log('🕐 Starting escrow release cron job...');

    // Jalankan setiap 5 menit
    cron.schedule('*/5 * * * *', async () => {
        console.log(`🔄 [${new Date().toISOString()}] Running escrow auto-release check...`);
        
        try {
            const result = await EscrowService.processAutoRelease();
            console.log(`✅ Escrow auto-release completed: ${result.processed} orders processed`);
        } catch (error) {
            console.error('❌ Escrow auto-release error:', error.message);
        }
    });

    console.log('✅ Escrow cron job started (every 5 minutes)');
};

// Jika dijalankan langsung
if (require.main === module) {
    startEscrowCron();
}

module.exports = { startEscrowCron };