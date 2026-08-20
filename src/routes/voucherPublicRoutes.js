const express = require('express');
const router = express.Router();
const voucherPublicController = require('../controllers/voucherPublicController');
const { optionalAuth } = require('../middlewares/auth');

router.get('/', voucherPublicController.getActiveVouchers);
router.post('/check', optionalAuth, voucherPublicController.checkVoucher);

module.exports = router;