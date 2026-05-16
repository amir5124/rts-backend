const ServiceModel = require('../models/serviceModel');

const ServiceController = {
    // GET /api/v1/services
    getAllServices: async (req, res) => {
        try {
            const services = await ServiceModel.getAllServices();
            res.json({
                success: true,
                message: 'Services retrieved successfully',
                data: services
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    },

    // GET /api/v1/services/:id
    getServiceById: async (req, res) => {
        try {
            const { id } = req.params;
            const service = await ServiceModel.getServiceById(id);

            if (!service) {
                return res.status(404).json({
                    success: false,
                    message: 'Service not found'
                });
            }

            res.json({
                success: true,
                message: 'Service retrieved successfully',
                data: service
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    },

    // GET /api/v1/services/:id/price?duration=60
    getPriceByDuration: async (req, res) => {
        try {
            const { id } = req.params;
            const { duration } = req.query;

            if (!duration) {
                return res.status(400).json({
                    success: false,
                    message: 'Duration query parameter is required'
                });
            }

            const price = await ServiceModel.getPriceByServiceAndDuration(id, duration);

            if (!price) {
                return res.status(404).json({
                    success: false,
                    message: `Price for duration ${duration} minutes not found`
                });
            }

            res.json({
                success: true,
                message: 'Price retrieved successfully',
                data: {
                    service_id: parseInt(id),
                    duration: parseInt(duration),
                    price: price.price
                }
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    },

    // POST /api/v1/services
    createService: async (req, res) => {
        try {
            const { service_name, description, service_image, prices } = req.body;

            // Validasi
            if (!service_name) {
                return res.status(400).json({
                    success: false,
                    message: 'service_name is required'
                });
            }

            if (!prices || !Array.isArray(prices) || prices.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'prices array is required with at least one price'
                });
            }

            // Validasi setiap price
            for (const price of prices) {
                if (!price.duration || !price.price) {
                    return res.status(400).json({
                        success: false,
                        message: 'Each price must have duration and price'
                    });
                }
            }

            const serviceId = await ServiceModel.createService(
                { service_name, description, service_image },
                prices
            );

            const newService = await ServiceModel.getServiceById(serviceId);

            res.status(201).json({
                success: true,
                message: 'Service created successfully',
                data: newService
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    },

    // PUT /api/v1/services/:id
    updateService: async (req, res) => {
        try {
            const { id } = req.params;
            const { service_name, description, service_image, prices } = req.body;

            // Cek apakah service ada
            const existingService = await ServiceModel.getServiceById(id);
            if (!existingService) {
                return res.status(404).json({
                    success: false,
                    message: 'Service not found'
                });
            }

            const updated = await ServiceModel.updateService(
                id,
                { service_name, description, service_image },
                prices
            );

            const updatedService = await ServiceModel.getServiceById(id);

            res.json({
                success: true,
                message: 'Service updated successfully',
                data: updatedService
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    },

    // DELETE /api/v1/services/:id
    deleteService: async (req, res) => {
        try {
            const { id } = req.params;

            const existingService = await ServiceModel.getServiceById(id);
            if (!existingService) {
                return res.status(404).json({
                    success: false,
                    message: 'Service not found'
                });
            }

            const deleted = await ServiceModel.deleteService(id);

            res.json({
                success: true,
                message: 'Service deleted successfully',
                data: {
                    id: parseInt(id)
                }
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    },

    // GET /api/v1/services/durations
    getAllDurations: async (req, res) => {
        try {
            const durations = await ServiceModel.getAllDurations();
            res.json({
                success: true,
                message: 'Durations retrieved successfully',
                data: durations
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    }
};

module.exports = ServiceController;