const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const upload = require('../middlewares/uploadMiddleware');
const verifyToken = require('../middlewares/auth');

// Route CRUD Users
router.get('/', verifyToken, userController.getUsers);           // Ambil semua
router.get('/:id', verifyToken, userController.getUserById);     // Ambil satu
router.put('/:id', verifyToken, upload.single('profile_pic'), userController.updateUser); // Edit
router.delete('/:id', verifyToken, userController.deleteUser);   // Hapus

module.exports = router;