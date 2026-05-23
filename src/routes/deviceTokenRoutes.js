const express = require('express');
const router = express.Router();
const deviceTokenController = require('../controllers/deviceTokenController');

// Public routes (atau bisa ditambahkan middleware authenticate)
router.post('/register', deviceTokenController.registerToken);
router.post('/unregister', deviceTokenController.unregisterToken);
router.post('/reactivate', deviceTokenController.reactivateToken);
router.put('/last-used', deviceTokenController.updateLastUsed);
router.delete('/delete', deviceTokenController.deleteDevice);

// Protected routes (memerlukan authentication)
router.get('/user/:userId', deviceTokenController.getUserDevices);
router.post('/cleanup', deviceTokenController.cleanupInactiveDevices);

module.exports = router;