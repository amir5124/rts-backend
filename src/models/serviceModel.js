const db = require('../config/db');

const ServiceModel = {
    // Mendapatkan semua layanan dengan semua harga
    getAllServices: async () => {
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

        return rows.map(row => {
            // Handle jika prices adalah string kosong atau null
            let prices = [];
            if (row.prices && row.prices !== '[]' && row.prices !== 'null') {
                try {
                    prices = JSON.parse(row.prices);
                } catch (e) {
                    console.error('Error parsing prices for service:', row.id, e);
                    prices = [];
                }
            }
            return {
                id: row.id,
                service_name: row.service_name,
                description: row.description,
                service_image: row.service_image,
                created_at: row.created_at,
                prices: prices
            };
        });
    },

    // Mendapatkan layanan berdasarkan ID
    getServiceById: async (id) => {
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
        if (rows[0].prices && rows[0].prices !== '[]' && rows[0].prices !== 'null') {
            try {
                prices = JSON.parse(rows[0].prices);
            } catch (e) {
                console.error('Error parsing prices for service:', id, e);
                prices = [];
            }
        }

        return {
            id: rows[0].id,
            service_name: rows[0].service_name,
            description: rows[0].description,
            service_image: rows[0].service_image,
            created_at: rows[0].created_at,
            prices: prices
        };
    },

    // Mendapatkan harga spesifik berdasarkan service_id dan duration
    getPriceByServiceAndDuration: async (serviceId, duration) => {
        const query = `
            SELECT price FROM service_prices 
            WHERE service_id = ? AND duration = ?
        `;
        const [rows] = await db.query(query, [serviceId, duration]);
        return rows[0] || null;
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
            if (prices && prices.length > 0) {
                for (const price of prices) {
                    await connection.query(
                        `INSERT INTO service_prices (service_id, duration, price) 
                         VALUES (?, ?, ?)`,
                        [serviceId, price.duration, price.price]
                    );
                }
            }

            await connection.commit();
            return serviceId;
        } catch (error) {
            await connection.rollback();
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
            if (prices && prices.length > 0) {
                // Hapus harga lama
                await connection.query(`DELETE FROM service_prices WHERE service_id = ?`, [id]);

                // Insert harga baru
                for (const price of prices) {
                    await connection.query(
                        `INSERT INTO service_prices (service_id, duration, price) 
                         VALUES (?, ?, ?)`,
                        [id, price.duration, price.price]
                    );
                }
            }

            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    },

    // Hapus layanan (ON DELETE CASCADE akan otomatis hapus harga)
    deleteService: async (id) => {
        const [result] = await db.query(`DELETE FROM services WHERE id = ?`, [id]);
        return result.affectedRows > 0;
    },

    // Mendapatkan semua durasi yang tersedia
    getAllDurations: async () => {
        const [rows] = await db.query(`SELECT DISTINCT duration FROM service_prices ORDER BY duration`);
        return rows.map(row => row.duration);
    },

    // Tambahan: Mendapatkan service dengan minimal informasi (tanpa JSON_ARRAYAGG)
    getServicesBasic: async () => {
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
    },

    // Tambahan: Mendapatkan harga per service dalam format berbeda
    getServicesWithPricesFlat: async () => {
        const query = `
            SELECT 
                s.id,
                s.service_name,
                s.description,
                s.service_image,
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
    }
};

module.exports = ServiceModel;