const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');

// ==========================================
// URL BASE: /api/v1/orders
// ⚠️ TANPA MIDDLEWARE - HANYA UNTUK TESTING
// ==========================================

console.log('🚀 [ROUTES] Loading order routes WITHOUT authentication middleware');

// ========== ADMIN ONLY ROUTES (tanpa middleware auth) ==========
// ⚠️ Seharusnya hanya admin yang bisa akses
router.get('/all', (req, res, next) => {
    console.log(`📡 [ROUTE] GET /orders/all accessed by ${req.ip}`);
    next();
}, OrderController.getAllOrders);

router.get('/statistics', (req, res, next) => {
    console.log(`📡 [ROUTE] GET /orders/statistics accessed by ${req.ip}`);
    next();
}, OrderController.getOrderStatistics);

router.put('/status/:id', (req, res, next) => {
    console.log(`📡 [ROUTE] PUT /orders/status/${req.params.id} accessed by ${req.ip}`);
    next();
}, OrderController.updateOrderStatus);

// ========== MITRA ROUTES ==========
// Route untuk mendapatkan semua pesanan milik mitra tertentu
router.get('/mitra/:mitra_id', (req, res, next) => {
    console.log(`📡 [ROUTE] GET /orders/mitra/${req.params.mitra_id} accessed by ${req.ip}`);
    next();
}, OrderController.getOrdersByMitra);

// Route untuk mendapatkan detail pesanan oleh mitra (berdasarkan ID order)
router.get('/mitra/order/:id', (req, res, next) => {
    console.log(`📡 [ROUTE] GET /orders/mitra/order/${req.params.id} accessed by ${req.ip}`);
    console.log(`📝 [ROUTE] Setting req.user for testing - mitra_id: ${req.query.mitra_id || 20}`);

    // 🔥 Untuk testing tanpa middleware, set req.user manual
    // Ini akan dihapus ketika middleware authenticate sudah aktif
    if (!req.user) {
        req.user = {
            id: parseInt(req.query.mitra_id) || 20,  // Default mitra_id 20 untuk testing
            name: 'Test Mitra',
            role: 'mitra'
        };
        console.log(`👤 [ROUTE] Auto-set req.user:`, req.user);
    }

    next();
}, OrderController.getOrderDetailForMitra);

// Route untuk aksi mitra pada pesanan
router.post('/mitra/order/:id/accept', (req, res, next) => {
    console.log(`📡 [ROUTE] POST /orders/mitra/order/${req.params.id}/accept accessed by ${req.ip}`);
    if (!req.user) {
        req.user = { id: parseInt(req.query.mitra_id) || 20, name: 'Test Mitra', role: 'mitra' };
        console.log(`👤 [ROUTE] Auto-set req.user:`, req.user);
    }
    next();
}, OrderController.acceptOrder);

router.post('/mitra/order/:id/reject', (req, res, next) => {
    console.log(`📡 [ROUTE] POST /orders/mitra/order/${req.params.id}/reject accessed by ${req.ip}`);
    if (!req.user) {
        req.user = { id: parseInt(req.query.mitra_id) || 20, name: 'Test Mitra', role: 'mitra' };
        console.log(`👤 [ROUTE] Auto-set req.user:`, req.user);
    }
    next();
}, OrderController.rejectOrder);

router.post('/mitra/order/:id/start', (req, res, next) => {
    console.log(`📡 [ROUTE] POST /orders/mitra/order/${req.params.id}/start accessed by ${req.ip}`);
    if (!req.user) {
        req.user = { id: parseInt(req.query.mitra_id) || 20, name: 'Test Mitra', role: 'mitra' };
        console.log(`👤 [ROUTE] Auto-set req.user:`, req.user);
    }
    next();
}, OrderController.startOrder);

router.post('/mitra/order/:id/complete', (req, res, next) => {
    console.log(`📡 [ROUTE] POST /orders/mitra/order/${req.params.id}/complete accessed by ${req.ip}`);
    if (!req.user) {
        req.user = { id: parseInt(req.query.mitra_id) || 20, name: 'Test Mitra', role: 'mitra' };
        console.log(`👤 [ROUTE] Auto-set req.user:`, req.user);
    }
    next();
}, OrderController.completeOrder);

// ========== PUBLIC / CUSTOMER ROUTES ==========
router.post('/', (req, res, next) => {
    console.log(`📡 [ROUTE] POST /orders/ accessed by ${req.ip}`);
    console.log(`📝 [ROUTE] Request body:`, JSON.stringify(req.body, null, 2));
    next();
}, OrderController.createOrder);

router.get('/customer/:customer_id', (req, res, next) => {
    console.log(`📡 [ROUTE] GET /orders/customer/${req.params.customer_id} accessed by ${req.ip}`);
    next();
}, OrderController.getOrdersByCustomer);

router.post('/:id/cancel', (req, res, next) => {
    console.log(`📡 [ROUTE] POST /orders/${req.params.id}/cancel accessed by ${req.ip}`);
    next();
}, OrderController.cancelOrder);

// ========== ROUTES DENGAN PARAMETER ID (taruh di PALING AKHIR) ==========
router.get('/:id', (req, res, next) => {
    console.log(`📡 [ROUTE] GET /orders/${req.params.id} accessed by ${req.ip}`);
    next();
}, OrderController.getOrderById);

router.post('/mitra/order/:id/otw', (req, res, next) => {
    console.log(`📡 [ROUTE] POST /orders/mitra/order/${req.params.id}/otw`);
    if (!req.user) {
        req.user = { id: parseInt(req.query.mitra_id) || 20, name: 'Test Mitra', role: 'mitra' };
        console.log(`👤 [ROUTE] Auto-set req.user:`, req.user);
    }
    next();
}, OrderController.otwOrder);



module.exports = router;