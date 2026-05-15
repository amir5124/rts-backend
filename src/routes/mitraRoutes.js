const express = require('express');
const router = express.Router();
const mitraController = require('../controllers/mitraController');
const { verifyToken, isMitra } = require('../middlewares/auth');

// Public routes (tanpa auth untuk registrasi)
router.post('/register', mitraController.registerMitra);

// Protected routes (harus login dan role mitra)
router.get('/profile/:user_id', verifyToken, isMitra, mitraController.getMitraDetail);
router.put('/profile/:user_id', verifyToken, isMitra, mitraController.updateMitraProfile);
router.put('/check-profile/:user_id', verifyToken, isMitra, mitraController.checkMitraProfile);
router.patch('/toggle-online/:user_id', verifyToken, isMitra, mitraController.toggleOnlineStatus);
router.get('/dashboard/:user_id', verifyToken, isMitra, mitraController.getDashboard);

module.exports = router;