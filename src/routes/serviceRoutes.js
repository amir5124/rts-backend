const express = require('express');
const router = express.Router();
const ServiceController = require('../controllers/serviceController');

// GET all services
router.get('/', ServiceController.getAllServices);

// GET all durations
router.get('/durations', ServiceController.getAllDurations);

// GET service by id
router.get('/:id', ServiceController.getServiceById);

// GET price by duration (query param: ?duration=60)
router.get('/:id/price', ServiceController.getPriceByDuration);

// POST create service
router.post('/', ServiceController.createService);

// PUT update service
router.put('/:id', ServiceController.updateService);

// DELETE service
router.delete('/:id', ServiceController.deleteService);

module.exports = router;