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
router.get('/all', verifyToken, isAdmin, OrderController.getAllOrders);
router.get('/statistics', verifyToken, isAdmin, OrderController.getOrderStatistics);
router.put('/:id/status', verifyToken, isAdmin, OrderController.updateOrderStatus);

module.exports = router;