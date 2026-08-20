const express = require('express');
const router = express.Router();
const voucherPublicController = require('../controllers/voucherPublicController');
const { verifyToken, customerAuth } = require('../middlewares/auth');

// Daftar voucher aktif — publik, tidak wajib login
router.get('/', voucherPublicController.getActiveVouchers);

// Cek/validasi voucher — wajib login sebagai customer (butuh user_id untuk cek limit pemakaian)
router.post('/check',voucherPublicController.checkVoucher);

module.exports = router;