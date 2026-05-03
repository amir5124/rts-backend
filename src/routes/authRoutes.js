const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const upload = require('../middlewares/uploadMiddleware');

// Endpoint: /api/v1/auth/register
router.post('/register', upload.single('profile_pic'), authController.register);

// Endpoint: /api/v1/auth/login
router.post('/login', authController.login);
router.post('/logout', authController.logout);

module.exports = router;