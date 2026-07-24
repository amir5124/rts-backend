// src/routes/escrowRoutes.js
const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');
const authMiddleware = require('../middlewares/auth');

// 🔥 CEK APAKAH METHOD ADA SEBELUM DIGUNAKAN
const confirmOrderCompletion = OrderController.confirmOrderCompletion;
const getOrderReleaseStatus = OrderController.getOrderReleaseStatus;
const EscrowService = require('../services/escrowService');

/**
 * 🔥 CUSTOMER KONFIRMASI PESANAN SELESAI
 * POST /api/v1/escrow/orders/:id/confirm-completion
 * Header: Authorization: Bearer <token>
 */
// ✅ CEK METHOD ADA
if (typeof confirmOrderCompletion === 'function') {
    router.post(
        '/orders/:id/confirm-completion',
        authMiddleware,
        confirmOrderCompletion
    );
} else {
    console.warn('⚠️ confirmOrderCompletion method not found, skipping route');
    // Fallback: route sementara
    router.post('/orders/:id/confirm-completion', authMiddleware, (req, res) => {
        res.status(501).json({
            success: false,
            message: 'Feature coming soon: confirm order completion'
        });
    });
}

/**
 * 🔥 CEK STATUS RELEASE ESCROW
 * GET /api/v1/escrow/orders/:id/release-status
 */
if (typeof getOrderReleaseStatus === 'function') {
    router.get(
        '/orders/:id/release-status',
        authMiddleware,
        getOrderReleaseStatus
    );
} else {
    console.warn('⚠️ getOrderReleaseStatus method not found, skipping route');
    router.get('/orders/:id/release-status', authMiddleware, (req, res) => {
        res.status(501).json({
            success: false,
            message: 'Feature coming soon: get release status'
        });
    });
}

/**
 * 🔥 ADMIN: FORCE RELEASE ESCROW
 * POST /api/v1/escrow/admin/orders/:id/force-release
 */
router.post('/admin/orders/:id/force-release', authMiddleware, async (req, res) => {
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
});

/**
 * 🔥 ADMIN: RUN AUTO-RELEASE MANUALLY
 * POST /api/v1/escrow/admin/run-auto-release
 */
router.post('/admin/run-auto-release', authMiddleware, async (req, res) => {
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
});

module.exports = router;