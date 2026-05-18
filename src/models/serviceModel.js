const db = require('../config/db');

const ServiceModel = {
    // Mendapatkan semua layanan dengan semua harga
    getAllServices: async () => {
        try {
            const query = `
                SELECT 
                    s.id,
                    s.service_name,
                    s.description,
                    s.service_image,
                    s.created_at,
                    COALESCE(
                        JSON_ARRAYAGG(
                            JSON_OBJECT(
                                'duration', sp.duration,
                                'price', sp.price
                            )
                        ),
                        JSON_ARRAY()
                    ) AS prices
                FROM services s
                LEFT JOIN service_prices sp ON s.id = sp.service_id
                GROUP BY s.id
                ORDER BY s.id
            `;
            const [rows] = await db.query(query);

            // Handle hasil query dengan aman
            return rows.map(row => {
                let prices = [];

                // Cek apakah prices ada dan bukan null/undefined
                if (row.prices) {
                    try {
                        // Jika prices sudah berupa array
                        if (Array.isArray(row.prices)) {
                            prices = row.prices;
                        }
                        // Jika prices berupa string JSON
                        else if (typeof row.prices === 'string') {
                            // Cek apakah string valid dan bukan null
                            if (row.prices && row.prices !== 'null' && row.prices !== '[]') {
                                prices = JSON.parse(row.prices);
                            }
                        }
                        // Jika prices adalah object
                        else if (typeof row.prices === 'object') {
                            prices = row.prices;
                        }
                    } catch (e) {
                        console.error('❌ Error parsing prices for service:', row.id, e.message);
                        prices = [];
                    }
                }

                // Filter out any invalid price entries
                const validPrices = prices.filter(price =>
                    price && price.duration && price.price !== undefined
                );

                return {
                    id: row.id,
                    service_name: row.service_name,
                    description: row.description,
                    service_image: row.service_image,
                    created_at: row.created_at,
                    prices: validPrices
                };
            });
        } catch (error) {
            console.error('❌ Error in getAllServices:', error);
            throw error;
        }
    },

    // Mendapatkan layanan berdasarkan ID
    getServiceById: async (id) => {
        try {
            const query = `
                SELECT 
                    s.id,
                    s.service_name,
                    s.description,
                    s.service_image,
                    s.created_at,
                    COALESCE(
                        JSON_ARRAYAGG(
                            JSON_OBJECT(
                                'duration', sp.duration,
                                'price', sp.price
                            )
                        ),
                        JSON_ARRAY()
                    ) AS prices
                FROM services s
                LEFT JOIN service_prices sp ON s.id = sp.service_id
                WHERE s.id = ?
                GROUP BY s.id
            `;
            const [rows] = await db.query(query, [id]);

            if (rows.length === 0) return null;

            let prices = [];
            const row = rows[0];

            // Handle prices dengan aman
            if (row.prices) {
                try {
                    if (Array.isArray(row.prices)) {
                        prices = row.prices;
                    } else if (typeof row.prices === 'string') {
                        if (row.prices && row.prices !== 'null' && row.prices !== '[]') {
                            prices = JSON.parse(row.prices);
                        }
                    } else if (typeof row.prices === 'object') {
                        prices = row.prices;
                    }
                } catch (e) {
                    console.error('❌ Error parsing prices for service:', id, e.message);
                    prices = [];
                }
            }

            // Filter valid prices
            const validPrices = prices.filter(price =>
                price && price.duration && price.price !== undefined
            );

            return {
                id: row.id,
                service_name: row.service_name,
                description: row.description,
                service_image: row.service_image,
                created_at: row.created_at,
                prices: validPrices
            };
        } catch (error) {
            console.error('❌ Error in getServiceById:', error);
            throw error;
        }
    },

    // Mendapatkan harga spesifik berdasarkan service_id dan duration
    getPriceByServiceAndDuration: async (serviceId, duration) => {
        try {
            const query = `
                SELECT price, duration FROM service_prices 
                WHERE service_id = ? AND duration = ?
            `;
            const [rows] = await db.query(query, [serviceId, duration]);
            return rows[0] || null;
        } catch (error) {
            console.error('❌ Error in getPriceByServiceAndDuration:', error);
            throw error;
        }
    },

    // Membuat layanan baru beserta harganya
    createService: async (serviceData, prices) => {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Insert ke tabel services
            const [result] = await connection.query(
                `INSERT INTO services (service_name, description, service_image) 
                 VALUES (?, ?, ?)`,
                [serviceData.service_name, serviceData.description, serviceData.service_image || null]
            );

            const serviceId = result.insertId;

            // Insert ke tabel service_prices
            if (prices && Array.isArray(prices) && prices.length > 0) {
                for (const price of prices) {
                    // Validasi harga
                    if (price.duration && price.price) {
                        await connection.query(
                            `INSERT INTO service_prices (service_id, duration, price) 
                             VALUES (?, ?, ?)`,
                            [serviceId, price.duration, price.price]
                        );
                    }
                }
            }

            await connection.commit();
            return serviceId;
        } catch (error) {
            await connection.rollback();
            console.error('❌ Error in createService:', error);
            throw error;
        } finally {
            connection.release();
        }
    },

    // Update layanan
    updateService: async (id, serviceData, prices) => {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Build dynamic update query untuk services
            const updateFields = [];
            const updateValues = [];

            if (serviceData.service_name !== undefined) {
                updateFields.push('service_name = ?');
                updateValues.push(serviceData.service_name);
            }
            if (serviceData.description !== undefined) {
                updateFields.push('description = ?');
                updateValues.push(serviceData.description);
            }
            if (serviceData.service_image !== undefined) {
                updateFields.push('service_image = ?');
                updateValues.push(serviceData.service_image);
            }

            if (updateFields.length > 0) {
                updateValues.push(id);
                await connection.query(
                    `UPDATE services SET ${updateFields.join(', ')} WHERE id = ?`,
                    updateValues
                );
            }

            // Update harga jika ada
            if (prices !== undefined) {
                if (prices && Array.isArray(prices) && prices.length > 0) {
                    // Hapus harga lama
                    await connection.query(`DELETE FROM service_prices WHERE service_id = ?`, [id]);

                    // Insert harga baru
                    for (const price of prices) {
                        if (price.duration && price.price) {
                            await connection.query(
                                `INSERT INTO service_prices (service_id, duration, price) 
                                 VALUES (?, ?, ?)`,
                                [id, price.duration, price.price]
                            );
                        }
                    }
                } else if (prices === null || (Array.isArray(prices) && prices.length === 0)) {
                    // Hapus semua harga jika prices dikirim sebagai array kosong atau null
                    await connection.query(`DELETE FROM service_prices WHERE service_id = ?`, [id]);
                }
            }

            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            console.error('❌ Error in updateService:', error);
            throw error;
        } finally {
            connection.release();
        }
    },

    // Hapus layanan (ON DELETE CASCADE akan otomatis hapus harga)
    deleteService: async (id) => {
        try {
            const [result] = await db.query(`DELETE FROM services WHERE id = ?`, [id]);
            return result.affectedRows > 0;
        } catch (error) {
            console.error('❌ Error in deleteService:', error);
            throw error;
        }
    },

    // Mendapatkan semua durasi yang tersedia
    getAllDurations: async () => {
        try {
            const [rows] = await db.query(`
                SELECT DISTINCT duration 
                FROM service_prices 
                WHERE duration IS NOT NULL 
                ORDER BY duration
            `);
            return rows.map(row => row.duration);
        } catch (error) {
            console.error('❌ Error in getAllDurations:', error);
            throw error;
        }
    },

    // Mendapatkan semua harga unik
    getAllPrices: async () => {
        try {
            const [rows] = await db.query(`
                SELECT DISTINCT price 
                FROM service_prices 
                WHERE price IS NOT NULL 
                ORDER BY price
            `);
            return rows.map(row => row.price);
        } catch (error) {
            console.error('❌ Error in getAllPrices:', error);
            throw error;
        }
    },

    // Mendapatkan service dengan minimal informasi (tanpa JSON_ARRAYAGG) - untuk fallback
    getServicesBasic: async () => {
        try {
            const query = `
                SELECT 
                    s.id,
                    s.service_name,
                    s.description,
                    s.service_image,
                    s.created_at
                FROM services s
                ORDER BY s.id
            `;
            const [rows] = await db.query(query);
            return rows;
        } catch (error) {
            console.error('❌ Error in getServicesBasic:', error);
            throw error;
        }
    },

    // Mendapatkan harga per service dalam format flat (tidak di-group)
    getServicesWithPricesFlat: async () => {
        try {
            const query = `
                SELECT 
                    s.id,
                    s.service_name,
                    s.description,
                    s.service_image,
                    s.created_at,
                    sp.duration,
                    sp.price
                FROM services s
                LEFT JOIN service_prices sp ON s.id = sp.service_id
                ORDER BY s.id, sp.duration
            `;
            const [rows] = await db.query(query);

            // Group by service
            const servicesMap = new Map();

            for (const row of rows) {
                if (!servicesMap.has(row.id)) {
                    servicesMap.set(row.id, {
                        id: row.id,
                        service_name: row.service_name,
                        description: row.description,
                        service_image: row.service_image,
                        created_at: row.created_at,
                        prices: []
                    });
                }

                if (row.duration && row.price) {
                    servicesMap.get(row.id).prices.push({
                        duration: row.duration,
                        price: row.price
                    });
                }
            }

            return Array.from(servicesMap.values());
        } catch (error) {
            console.error('❌ Error in getServicesWithPricesFlat:', error);
            throw error;
        }
    },

    // Search services by name
    searchServices: async (keyword) => {
        try {
            const query = `
                SELECT 
                    s.id,
                    s.service_name,
                    s.description,
                    s.service_image,
                    s.created_at
                FROM services s
                WHERE s.service_name LIKE ? OR s.description LIKE ?
                ORDER BY s.service_name
            `;
            const searchParam = `%${keyword}%`;
            const [rows] = await db.query(query, [searchParam, searchParam]);
            return rows;
        } catch (error) {
            console.error('❌ Error in searchServices:', error);
            throw error;
        }
    },

    // Get service count
    getServiceCount: async () => {
        try {
            const [rows] = await db.query(`SELECT COUNT(*) as count FROM services`);
            return rows[0]?.count || 0;
        } catch (error) {
            console.error('❌ Error in getServiceCount:', error);
            throw error;
        }
    }
};

module.exports = ServiceModel;