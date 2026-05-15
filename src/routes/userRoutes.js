const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const upload = require('../middlewares/uploadMiddleware');
const { verifyToken } = require('../middlewares/auth');

/**
 * @route   GET /api/users
 * @desc    Ambil semua data user
 * @access  Private
 */
router.get('/', verifyToken, userController.getUsers);

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
    upload.single('profile_pic'), // Middleware untuk handle upload satu file
    userController.updateUser
);

/**
 * @route   PUT /api/users/:id/change-password
 * @desc    Ganti password user
 * @access  Private
 */
router.put('/:id/change-password', verifyToken, userController.changePassword);

/**
 * @route   DELETE /api/users/:id
 * @desc    Hapus user dan file foto terkait
 * @access  Private
 */
router.delete('/:id', verifyToken, userController.deleteUser);

module.exports = router;