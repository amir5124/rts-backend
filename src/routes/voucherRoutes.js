const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const { adminAuth } = require('../middlewares/auth');

router.use(adminAuth);

router.post('/', voucherController.createVoucher);
router.get('/', voucherController.getAllVouchers);
router.get('/:id', voucherController.getVoucherById);
router.put('/:id', voucherController.updateVoucher);
router.delete('/:id', voucherController.deleteVoucher);
router.get('/:id/usages', voucherController.getVoucherUsages);

module.exports = router;