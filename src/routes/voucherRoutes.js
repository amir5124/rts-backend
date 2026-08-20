const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const { adminAuth } = require('../middlewares/auth');
const uploadVoucher = require('../middlewares/uploadVoucher');

router.use(adminAuth);

router.post('/', uploadVoucher.single('image'), voucherController.createVoucher);
router.get('/', voucherController.getAllVouchers);
router.get('/:id', voucherController.getVoucherById);
router.put('/:id', uploadVoucher.single('image'), voucherController.updateVoucher);
router.delete('/:id', voucherController.deleteVoucher);
router.get('/:id/usages', voucherController.getVoucherUsages);

module.exports = router;