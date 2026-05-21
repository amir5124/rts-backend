// routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');
const { verifyToken, isAdmin } = require('../middlewares/auth');

// URL: /api/v1/orders

// Public / Customer routes
router.post('/', OrderController.createOrder);
router.get('/customer/:customer_id', OrderController.getOrdersByCustomer);

// Admin only routes (perlu middleware auth dan isAdmin)
router.get('/all', verifyToken, isAdmin, OrderController.getAllOrders);
router.get('/statistics', verifyToken, isAdmin, OrderController.getOrderStatistics);

module.exports = router;