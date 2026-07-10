const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');
const { verifyToken, isMitra, isAdmin } = require('../middleware/authMiddleware'); // sesuaikan path

// ==========================================
// URL BASE: /api/v1/orders
// ==========================================

// ========== ADMIN ONLY ROUTES ==========
router.get('/all', verifyToken, isAdmin, OrderController.getAllOrders);
router.get('/statistics', verifyToken, isAdmin, OrderController.getOrderStatistics);
router.put('/status/:id', verifyToken, isAdmin, OrderController.updateOrderStatus);

// ========== MITRA ROUTES ==========
router.get('/mitra/:mitra_id', verifyToken, isMitra, OrderController.getOrdersByMitra);
router.get('/mitra/order/:id', verifyToken, isMitra, OrderController.getOrderDetailForMitra);
router.post('/mitra/order/:id/accept', verifyToken, isMitra, OrderController.acceptOrder);
router.post('/mitra/order/:id/reject', verifyToken, isMitra, OrderController.rejectOrder);
router.post('/mitra/order/:id/otw', verifyToken, isMitra, OrderController.otwOrder);
router.post('/mitra/order/:id/start', verifyToken, isMitra, OrderController.startOrder);
router.post('/mitra/order/:id/complete', verifyToken, isMitra, OrderController.completeOrder);

// ========== PUBLIC / CUSTOMER ROUTES ==========
router.post('/', OrderController.createOrder); // biasanya perlu verifyToken juga untuk customer
router.get('/customer/:customer_id', verifyToken, OrderController.getOrdersByCustomer);
router.post('/:id/cancel', verifyToken, OrderController.cancelOrder);

// ========== ROUTES DENGAN PARAMETER ID (paling akhir) ==========
router.get('/:id', verifyToken, OrderController.getOrderById);

module.exports = router;