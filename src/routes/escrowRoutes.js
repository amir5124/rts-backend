// src/routes/escrowRoutes.js
const express = require('express');
const router = express.Router();

// 🔥 IMPORT CONTROLLER & SERVICE
const OrderController = require('../controllers/orderController');
const EscrowService = require('../services/escrowService');

// 🔥 IMPORT AUTH MIDDLEWARE
const { verifyToken, isAdmin } = require('../middlewares/auth');

console.log('🔍 verifyToken type:', typeof verifyToken);
console.log('🔍 isAdmin type:', typeof isAdmin);

// 🔥 CEK METHOD DI ORDER CONTROLLER
const confirmOrderCompletion = OrderController.confirmOrderCompletion;
const getOrderReleaseStatus = OrderController.getOrderReleaseStatus;

console.log('🔍 confirmOrderCompletion type:', typeof confirmOrderCompletion);
console.log('🔍 getOrderReleaseStatus type:', typeof getOrderReleaseStatus);

// ========================================================================
// 🔥 ROUTE 1: Customer Confirm Order Completion
// POST /api/v1/escrow/orders/:id/confirm-completion
// Header: Authorization: Bearer <token>
// ========================================================================
if (typeof confirmOrderCompletion === 'function') {
    router.post(
        '/orders/:id/confirm-completion',
        verifyToken,  // 🔥 Gunakan verifyToken
        confirmOrderCompletion
    );
    console.log('✅ Route registered: POST /orders/:id/confirm-completion');
} else {
    console.warn('⚠️ confirmOrderCompletion not found, using fallback');
    router.post('/orders/:id/confirm-completion', verifyToken, (req, res) => {
        res.status(501).json({
            success: false,
            message: 'Feature coming soon: confirm order completion'
        });
    });
}

// ========================================================================
// 🔥 ROUTE 2: Get Order Release Status
// GET /api/v1/escrow/orders/:id/release-status
// Header: Authorization: Bearer <token>
// ========================================================================
if (typeof getOrderReleaseStatus === 'function') {
    router.get(
        '/orders/:id/release-status',
        verifyToken,  // 🔥 Gunakan verifyToken
        getOrderReleaseStatus
    );
    console.log('✅ Route registered: GET /orders/:id/release-status');
} else {
    console.warn('⚠️ getOrderReleaseStatus not found, using fallback');
    router.get('/orders/:id/release-status', verifyToken, (req, res) => {
        res.status(501).json({
            success: false,
            message: 'Feature coming soon: get release status'
        });
    });
}

// ========================================================================
// 🔥 ROUTE 3: Admin Force Release Escrow
// POST /api/v1/escrow/admin/orders/:id/force-release
// Header: Authorization: Bearer <token> (Admin only)
// ========================================================================
router.post(
    '/admin/orders/:id/force-release',
    verifyToken,  // 🔥 Validasi token dulu
    isAdmin,      // 🔥 Baru cek admin
    async (req, res) => {
        try {
            const { id } = req.params;
            const result = await EscrowService.releaseEscrowToMitra(id, 'admin_force');
            res.json({
                success: true,
                message: 'Escrow force released successfully',
                data: result
            });
        } catch (error) {
            console.error('❌ Force release error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to force release escrow'
            });
        }
    }
);
console.log('✅ Route registered: POST /admin/orders/:id/force-release');

// ========================================================================
// 🔥 ROUTE 4: Admin Run Auto-Release Manually
// POST /api/v1/escrow/admin/run-auto-release
// Header: Authorization: Bearer <token> (Admin only)
// ========================================================================
router.post(
    '/admin/run-auto-release',
    verifyToken,  // 🔥 Validasi token dulu
    isAdmin,      // 🔥 Baru cek admin
    async (req, res) => {
        try {
            const result = await EscrowService.processAutoRelease();
            res.json({
                success: true,
                message: 'Auto-release processed',
                data: result
            });
        } catch (error) {
            console.error('❌ Auto-release error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to process auto-release'
            });
        }
    }
);
console.log('✅ Route registered: POST /admin/run-auto-release');

// ========================================================================
// 🔥 ROUTE 5: Health Check (tanpa auth)
// GET /api/v1/escrow/health
// ========================================================================
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Escrow routes are working',
        timestamp: new Date().toISOString(),
        features: {
            confirm_completion: typeof confirmOrderCompletion === 'function',
            release_status: typeof getOrderReleaseStatus === 'function',
            escrow_service: typeof EscrowService.releaseEscrowToMitra === 'function'
        }
    });
});
console.log('✅ Route registered: GET /health');

console.log('✅ All escrow routes loaded successfully');

module.exports = router;