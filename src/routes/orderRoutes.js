const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');

// URL: /api/v1/orders

// ========== ADMIN ONLY ROUTES (taruh di paling atas agar tidak bentrok) ==========
router.get('/all', OrderController.getAllOrders);
router.get('/statistics', OrderController.getOrderStatistics);
router.put('/status/:id', OrderController.updateOrderStatus);  // ✅ Sudah ada

// ========== MITRA ROUTES ==========
router.get('/mitra/:mitra_id', OrderController.getOrdersByMitra);  // ⭐ TAMBAHKAN INI

// ========== PUBLIC / CUSTOMER ROUTES ==========
router.post('/', OrderController.createOrder);
router.get('/customer/:customer_id', OrderController.getOrdersByCustomer);

// ========== ROUTES DENGAN PARAMETER ID (taruh di paling akhir) ==========
router.get('/:id', OrderController.getOrderById);
router.post('/:id/cancel', OrderController.cancelOrder);

module.exports = router;