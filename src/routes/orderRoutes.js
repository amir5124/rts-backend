const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');
const { verifyToken, isAdmin } = require('../middlewares/auth');

// URL: /api/v1/orders

// ========== PUBLIC / CUSTOMER ROUTES ==========
router.post('/', OrderController.createOrder);
router.get('/customer/:customer_id', OrderController.getOrdersByCustomer);
router.get('/:id', OrderController.getOrderById);
router.post('/:id/cancel', OrderController.cancelOrder);

// ========== ADMIN ONLY ROUTES ==========
// Tambahkan middleware verifyToken dan isAdmin untuk keamanan
router.get('/all', OrderController.getAllOrders);
router.get('/statistics', OrderController.getOrderStatistics);
router.put('/:id/status', OrderController.updateOrderStatus);

module.exports = router;