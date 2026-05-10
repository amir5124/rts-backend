const express = require('express');
const router = express.Router();
const PaymentController = require('../controllers/paymentController');

// URL: /api/v1/payments/status/:reff
router.get('/status/:reff', PaymentController.checkStatus);

// URL: /api/v1/payments/callback
router.post('/callback', PaymentController.handleCallback);

module.exports = router;