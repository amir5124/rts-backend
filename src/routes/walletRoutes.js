const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { verifyToken, isAdmin } = require('../middlewares/auth');

// Semua route wallet memerlukan authentication
router.use(verifyToken);

// Route untuk user biasa (customer & mitra)
router.get('/balance/:user_id', walletController.getBalance);
router.get('/transactions/:user_id', walletController.getTransactionHistory);
router.post('/topup/:user_id', walletController.topupBalance);
router.post('/transfer/:from_user_id', walletController.transferBalance);
router.post('/withdraw/:user_id', walletController.requestWithdraw);

// Route untuk admin (konfirmasi)
router.post('/topup/confirm', isAdmin, walletController.confirmTopup);
router.post('/withdraw/confirm', isAdmin, walletController.confirmWithdraw);

module.exports = router;