// src/routes/escrowRoutes.js
const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');
const authMiddleware = require('../middlewares/authMiddleware');

/**
 * 🔥 CUSTOMER KONFIRMASI PESANAN SELESAI
 * POST /api/v1/escrow/orders/:id/confirm-completion
 * Header: Authorization: Bearer <token>
 * 
 * Response:
 * - success: true
 * - message: Dana telah ditransfer ke mitra
 * - data: { order_id, release_status, escrow_amount, ... }
 */
router.post(
    '/orders/:id/confirm-completion',
    authMiddleware,
    OrderController.confirmOrderCompletion
);

/**
 * 🔥 CEK STATUS RELEASE ESCROW
 * GET /api/v1/escrow/orders/:id/release-status
 * Header: Authorization: Bearer <token>
 * 
 * Response:
 * - release_status: 'pending' | 'customer_confirmed' | 'auto_released'
 * - hours_remaining: number (sisa jam sebelum auto-release)
 * - can_confirm: boolean
 */
router.get(
    '/orders/:id/release-status',
    authMiddleware,
    OrderController.getOrderReleaseStatus
);

/**
 * 🔥 ADMIN: FORCE RELEASE ESCROW (untuk keperluan admin)
 * POST /api/v1/escrow/admin/orders/:id/force-release
 * Header: Authorization: Bearer <token> (Admin only)
 */
router.post(
    '/admin/orders/:id/force-release',
    authMiddleware,
    // TODO: Add admin middleware
    async (req, res) => {
        // Implementasi force release
        const { id } = req.params;
        const EscrowService = require('../services/escrowService');

        try {
            const result = await EscrowService.releaseEscrowToMitra(id, 'admin_force');
            res.json({
                success: true,
                message: 'Escrow force released successfully',
                data: result
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

/**
 * 🔥 ADMIN: RUN AUTO-RELEASE MANUALLY
 * POST /api/v1/escrow/admin/run-auto-release
 * Header: Authorization: Bearer <token> (Admin only)
 */
router.post(
    '/admin/run-auto-release',
    authMiddleware,
    // TODO: Add admin middleware
    async (req, res) => {
        const EscrowService = require('../services/escrowService');

        try {
            const result = await EscrowService.processAutoRelease();
            res.json({
                success: true,
                message: 'Auto-release processed',
                data: result
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

module.exports = router;