const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');

// URL: /api/v1/orders

// ========== ADMIN ONLY ROUTES (taruh di paling atas agar tidak bentrok) ==========
router.get('/all', OrderController.getAllOrders);
router.get('/statistics', OrderController.getOrderStatistics);
router.put('/status/:id', OrderController.updateOrderStatus);

// ========== MITRA ROUTES ==========
// Route untuk mendapatkan semua pesanan milik mitra tertentu
router.get('/mitra/:mitra_id', OrderController.getOrdersByMitra);

// Route untuk mendapatkan detail pesanan oleh mitra (berdasarkan ID order)
router.get('/mitra/order/:id', OrderController.getOrderDetailForMitra);

// Route untuk aksi mitra pada pesanan
router.post('/mitra/order/:id/accept', OrderController.acceptOrder);
router.post('/mitra/order/:id/reject', OrderController.rejectOrder);
router.post('/mitra/order/:id/start', OrderController.startOrder);
router.post('/mitra/order/:id/complete', OrderController.completeOrder);

// ========== PUBLIC / CUSTOMER ROUTES ==========
router.post('/', OrderController.createOrder);
router.get('/customer/:customer_id', OrderController.getOrdersByCustomer);
router.post('/:id/cancel', OrderController.cancelOrder);

// ========== ROUTES DENGAN PARAMETER ID (taruh di PALING AKHIR) ==========
router.get('/:id', OrderController.getOrderById);

module.exports = router;