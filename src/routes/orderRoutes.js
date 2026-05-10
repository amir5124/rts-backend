const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');

// URL: /api/v1/orders
router.post('/', OrderController.createOrder);
router.get('/:id', OrderController.getOrderDetail);

module.exports = router;