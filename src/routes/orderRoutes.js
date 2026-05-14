const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');

// URL: /api/v1/orders
router.post('/', OrderController.createOrder);
// Di file orderRoutes.js
router.get('/customer/:customer_id', OrderController.getOrdersByCustomer)
// BUKAN router.get('/orders/customer/:customer_id', ...)

module.exports = router;