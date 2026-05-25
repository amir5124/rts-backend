const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const upload = require('../middlewares/uploadMiddleware');
const { verifyToken } = require('../middlewares/auth');

/**
 * @route   GET /api/users
 * @desc    Ambil semua data user
 * @access  Private (Admin only)
 */
router.get('/', userController.getUsers);

/**
 * @route   GET /api/users/statistics
 * @desc    Ambil statistik user
 * @access  Private (Admin only)
 */
router.get('/statistics', userController.getUserStatistics);

/**
 * @route   GET /api/users/:id
 * @desc    Ambil detail user berdasarkan ID
 * @access  Private
 */
router.get('/:id', verifyToken, userController.getUserById);

/**
 * @route   PUT /api/users/:id
 * @desc    Update data profile (nama, email, phone, & foto)
 * @access  Private
 */
router.put(
    '/:id',
    verifyToken,
    upload.single('profile_pic'),
    userController.updateUser
);

/**
 * @route   PUT /api/users/:id/status
 * @desc    Update status aktif/nonaktif user
 * @access  Private (Admin only)
 */
router.put('/:id/status', userController.updateUserStatus);

/**
 * @route   PUT /api/users/:id/change-password
 * @desc    Ganti password user
 * @access  Private
 */
router.put('/:id/change-password', verifyToken, userController.changePassword);

/**
 * @route   DELETE /api/users/:id
 * @desc    Hapus user dan file foto terkait
 * @access  Private (Admin only)
 */
router.delete('/:id', userController.deleteUser);

module.exports = router;