const express = require('express');
const router = express.Router();
const mitraController = require('../controllers/mitraController');
const { verifyToken, isMitra, isAdmin } = require('../middlewares/auth'); // ← Tambahkan isAdmin

// ========== PUBLIC ROUTES (tanpa auth) ==========
router.post('/register', mitraController.registerMitra);
router.get('/status/:user_id', mitraController.checkMitraStatus);
router.get('/therapists', mitraController.getAllTherapists);
router.get('/therapists/service/:service_id', mitraController.getTherapistsByService);

// ========== MITRA PROTECTED ROUTES (harus login dan role mitra) ==========
router.get('/profile/:user_id', verifyToken, isMitra, mitraController.getMitraDetail);
router.put('/profile/:user_id', verifyToken, isMitra, mitraController.updateMitraProfile);
router.get('/check-profile/:user_id', verifyToken, isMitra, mitraController.checkMitraProfile);
router.patch('/toggle-online/:user_id', verifyToken, isMitra, mitraController.toggleOnlineStatus);
router.get('/dashboard/:user_id', verifyToken, isMitra, mitraController.getDashboard);

// ========== ADMIN ONLY ROUTES (harus login dan role admin) ==========
router.get('/admin/registrations', verifyToken, isAdmin, mitraController.getAllMitraRegistrations);
router.get('/admin/registrations/:user_id', verifyToken, isAdmin, mitraController.getMitraRegistrationDetail);
router.put('/admin/approve/:user_id', verifyToken, isAdmin, mitraController.approveMitra);
router.delete('/admin/delete/:user_id', verifyToken, isAdmin, mitraController.deleteMitra);

module.exports = router;