const express = require('express');
const router = express.Router();
const mitraController = require('../controllers/mitraController');
const { verifyToken, isMitra } = require('../middlewares/auth');

// Public routes (tanpa auth untuk registrasi)
router.post('/register', mitraController.registerMitra);

// NEW: Check status - bisa tanpa auth atau dengan auth tergantung kebutuhan
router.get('/status/:user_id', mitraController.checkMitraStatus); // Bisa diakses tanpa auth dulu

// Protected routes (harus login dan role mitra)
router.get('/profile/:user_id', verifyToken, isMitra, mitraController.getMitraDetail);
router.put('/profile/:user_id', verifyToken, isMitra, mitraController.updateMitraProfile);
router.get('/check-profile/:user_id', verifyToken, isMitra, mitraController.checkMitraProfile);
router.patch('/toggle-online/:user_id', verifyToken, isMitra, mitraController.toggleOnlineStatus);
router.get('/dashboard/:user_id', verifyToken, isMitra, mitraController.getDashboard);
// Get all therapists (public)
router.get('/therapists', mitraController.getAllTherapists);
router.get('/therapists/service/:service_id', mitraController.getTherapistsByService);

module.exports = router;