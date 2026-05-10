const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');
const PaymentController = require('../controllers/paymentController');

// 1. Endpoint untuk membuat order awal
router.post('/', OrderController.createOrder);

// 2. Endpoint Callback untuk LinkQu
// Pastikan URL ini sesuai dengan yang didaftarkan di dashboard LinkQu:
// https://api.siappgo.id/api/payments/callback
router.post('/payments/callback', PaymentController.handleCallback);

// 3. Endpoint Check Status untuk Frontend/Mobile
// URL: https://api.siappgo.id/api/v1/payments/status/:reff
router.get('/payments/status/:reff', PaymentController.checkStatus);

module.exports = router;