const express = require('express');
const router = express.Router();
const deviceTokenController = require('../controllers/deviceTokenController');

// Middleware untuk authentication (optional)
const { authenticateToken } = require('../middleware/auth');

/**
 * Device Token Management Routes
 * Base path: /api/v1/devices
 */

// Public routes (atau bisa ditambahkan middleware authenticate)
router.post('/register', deviceTokenController.registerToken);
router.post('/unregister', deviceTokenController.unregisterToken);
router.post('/reactivate', deviceTokenController.reactivateToken);
router.put('/last-used', deviceTokenController.updateLastUsed);
router.delete('/delete', deviceTokenController.deleteDevice);

// Protected routes (memerlukan authentication)
router.get('/user/:userId', authenticateToken, deviceTokenController.getUserDevices);
router.post('/cleanup', authenticateToken, deviceTokenController.cleanupInactiveDevices);

module.exports = router;