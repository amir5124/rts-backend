const express = require('express');
const router = express.Router();
const voucherPublicController = require('../controllers/voucherPublicController');
const { verifyToken } = require('../middlewares/auth');

// Daftar voucher aktif — publik, tidak wajib login
router.get('/', voucherPublicController.getActiveVouchers);

// Cek/validasi voucher — wajib login (siapapun rolenya), butuh req.user.id untuk cek limit pemakaian
router.post('/check', verifyToken, voucherPublicController.checkVoucher);

module.exports = router;