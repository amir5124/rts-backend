const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');
const PaymentController = require('../controllers/paymentController');

// Endpoint yang dipanggil Mobile App
router.post('/', OrderController.createOrder);

// Endpoint Callback untuk LinkQu (Daftarkan URL ini di Dashboard LinkQu)
// router.post('/payments/callback', PaymentController.handleCallback);

module.exports = router;