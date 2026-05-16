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
                JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'duration', sp.duration,
                        'price', sp.price
                    )
                ) AS prices
            FROM services s
            LEFT JOIN service_prices sp ON s.id = sp.service_id
            GROUP BY s.id
            ORDER BY s.id
        `;
        const [rows] = await db.query(query);
        return rows.map(row => ({
            ...row,
            prices: JSON.parse(row.prices)
        }));
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
                JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'duration', sp.duration,
                        'price', sp.price
                    )
                ) AS prices
            FROM services s
            LEFT JOIN service_prices sp ON s.id = sp.service_id
            WHERE s.id = ?
            GROUP BY s.id
        `;
        const [rows] = await db.query(query, [id]);
        if (rows.length === 0) return null;
        return {
            ...rows[0],
            prices: JSON.parse(rows[0].prices)
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
            for (const price of prices) {
                await connection.query(
                    `INSERT INTO service_prices (service_id, duration, price) 
                     VALUES (?, ?, ?)`,
                    [serviceId, price.duration, price.price]
                );
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

            // Update tabel services
            await connection.query(
                `UPDATE services SET 
                    service_name = COALESCE(?, service_name),
                    description = COALESCE(?, description),
                    service_image = COALESCE(?, service_image)
                 WHERE id = ?`,
                [serviceData.service_name, serviceData.description, serviceData.service_image, id]
            );

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
    }
};

module.exports = ServiceModel;