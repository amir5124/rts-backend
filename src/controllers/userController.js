const User = require('../models/userModel');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

const UPLOAD_BASE_PATH = process.env.UPLOAD_PATH || '/app/uploads';
const PROFILES_PATH = path.join(UPLOAD_BASE_PATH, 'profiles');

console.log(`📁 [USER CONTROLLER] PROFILES_PATH: ${PROFILES_PATH}`);

const userController = {
    // 1. Ambil semua User
    getUsers: async (req, res) => {
        try {
            const users = await User.findAll();

            // Hapus password dari response
            const safeUsers = users.map(({ password, ...user }) => user);

            res.json({
                success: true,
                data: {
                    users: safeUsers,
                    total: safeUsers.length
                }
            });
        } catch (err) {
            console.error('Error in getUsers:', err);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    },

    // 2. Ambil User berdasarkan ID
    getUserById: async (req, res) => {
        try {
            const user = await User.findById(req.params.id);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User tidak ditemukan"
                });
            }

            // Jangan tampilkan password di response
            const { password, ...userData } = user;
            res.json({
                success: true,
                data: userData
            });
        } catch (err) {
            console.error('Error in getUserById:', err);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    },

    // 3. Edit Profile (Termasuk Foto)
    updateUser: async (req, res) => {
        let connection;
        const userId = req.params.id;
        const { name, email, phone } = req.body;
        const file = req.file;

        console.log(`\n========== [UPDATE USER] ==========`);
        console.log(`📝 User ID: ${userId}`);
        console.log(`📝 Request body:`, { name, email, phone });
        console.log(`📝 File uploaded:`, file ? file.filename : 'No file');

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // 1. Cek user exists
            const [users] = await connection.query(
                'SELECT id, name, email, phone, profile_pic FROM users WHERE id = ?',
                [userId]
            );

            if (users.length === 0) {
                await connection.rollback();
                console.log(`❌ User ${userId} not found`);
                return res.status(404).json({
                    success: false,
                    message: 'User tidak ditemukan'
                });
            }

            const currentUser = users[0];
            console.log(`✅ Current user data:`, currentUser);

            // 2. Handle upload file profile picture
            let newProfilePic = currentUser.profile_pic;

            if (file) {
                // 🔥 PERBAIKAN: Gunakan PROFILES_PATH dari environment
                const fileName = file.filename;
                const newFilePath = path.join(PROFILES_PATH, fileName);

                console.log(`📸 New file uploaded: ${fileName}`);
                console.log(`📁 File path: ${newFilePath}`);

                // Cek apakah file benar-benar ada
                if (fs.existsSync(newFilePath)) {
                    console.log(`✅ File saved successfully at: ${newFilePath}`);
                    newProfilePic = fileName;
                } else {
                    console.warn(`⚠️ File not found at: ${newFilePath}`);
                }
            }

            // 3. Update data user
            const updateData = {
                name: name || currentUser.name,
                email: email || currentUser.email,
                phone: phone || currentUser.phone,
                profile_pic: newProfilePic
            };

            console.log(`🔄 Updating user ${userId} with:`, updateData);

            await connection.query(
                `UPDATE users SET 
                    name = ?, 
                    email = ?, 
                    phone = ?, 
                    profile_pic = ? 
                 WHERE id = ?`,
                [updateData.name, updateData.email, updateData.phone, updateData.profile_pic, userId]
            );

            await connection.commit();
            console.log(`✅ User ${userId} updated successfully`);

            // 4. Build full URL untuk profile picture
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const profilePicUrl = updateData.profile_pic
                ? `${baseUrl}/uploads/profiles/${updateData.profile_pic}`
                : null;

            console.log(`🔗 Profile picture URL: ${profilePicUrl}`);

            // 5. Return response
            res.json({
                success: true,
                message: 'Profile berhasil diperbarui',
                data: {
                    id: parseInt(userId),
                    name: updateData.name,
                    email: updateData.email,
                    phone: updateData.phone,
                    profile_pic: profilePicUrl,
                    profile_pic_filename: updateData.profile_pic
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Error in updateUser:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Terjadi kesalahan pada server'
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // controllers/userController.js - Tambah fungsi baru
    updateProfileWithBase64: async (req, res) => {
        let connection;
        const userId = req.params.id;
        const { name, email, phone, profile_pic_base64 } = req.body;

        console.log(`\n========== [UPDATE USER WITH BASE64] ==========`);
        console.log(`📝 User ID: ${userId}`);
        console.log(`📝 Base64 length: ${profile_pic_base64?.length || 0}`);

        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // Cek user exists
            const [users] = await connection.query(
                'SELECT id, profile_pic FROM users WHERE id = ?',
                [userId]
            );

            if (users.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'User tidak ditemukan'
                });
            }

            let newProfilePic = users[0].profile_pic;

            // Handle base64 image
            if (profile_pic_base64) {
                try {
                    // Extract base64 data
                    const matches = profile_pic_base64.match(/^data:image\/([a-zA-Z0-9+_-]+);base64,(.+)$/);

                    if (matches && matches.length === 3) {
                        const imageType = matches[1];
                        const base64Data = matches[2];
                        const buffer = Buffer.from(base64Data, 'base64');

                        // Tentukan extension
                        let extension = 'jpg';
                        if (imageType === 'png') extension = 'png';
                        if (imageType === 'gif') extension = 'gif';
                        if (imageType === 'webp') extension = 'webp';

                        const filename = `profile_${Date.now()}.${extension}`;
                        const filepath = path.join(PROFILES_PATH, filename);

                        // Simpan file
                        fs.writeFileSync(filepath, buffer);
                        newProfilePic = filename;

                        console.log(`✅ Image saved: ${filename} (${buffer.length} bytes)`);
                    }
                } catch (imageError) {
                    console.error('Error processing image:', imageError);
                }
            }

            // Update database
            await connection.query(
                `UPDATE users SET 
                name = ?, 
                email = ?, 
                phone = ?, 
                profile_pic = ? 
             WHERE id = ?`,
                [name, email, phone, newProfilePic, userId]
            );

            await connection.commit();

            res.json({
                success: true,
                message: 'Profile berhasil diperbarui',
                data: {
                    id: parseInt(userId),
                    name: name,
                    email: email,
                    phone: phone,
                    profile_pic: newProfilePic
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Terjadi kesalahan pada server'
            });
        } finally {
            if (connection) connection.release();
        }
    },

    // 4. Update Status User (Aktif/Nonaktif)
    updateUserStatus: async (req, res) => {
        try {
            const id = req.params.id;
            const { is_active } = req.body;

            const user = await User.findById(id);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User tidak ditemukan"
                });
            }

            await User.updateStatus(id, is_active);

            res.json({
                success: true,
                message: is_active ? "User berhasil diaktifkan" : "User berhasil dinonaktifkan",
                data: {
                    id: parseInt(id),
                    is_active: is_active
                }
            });
        } catch (err) {
            console.error('Error in updateUserStatus:', err);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    },

    // 5. Ganti Password (Khusus)
    changePassword: async (req, res) => {
        try {
            const id = req.params.id;
            const { oldPassword, newPassword } = req.body;

            const user = await User.findById(id);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User tidak ditemukan"
                });
            }

            // Validasi password lama
            const isMatch = await bcrypt.compare(oldPassword, user.password);
            if (!isMatch) {
                return res.status(400).json({
                    success: false,
                    message: "Password lama salah"
                });
            }

            // Hash password baru
            const salt = await bcrypt.genSalt(10);
            const hashedStorePassword = await bcrypt.hash(newPassword, salt);

            await User.updatePassword(id, hashedStorePassword);
            res.json({
                success: true,
                message: "Password berhasil diganti"
            });
        } catch (err) {
            console.error('Error in changePassword:', err);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    },

    // 6. Hapus User
    deleteUser: async (req, res) => {
        try {
            const user = await User.findById(req.params.id);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User tidak ditemukan"
                });
            }

            // Hapus file foto jika ada
            if (user.profile_pic) {
                const photoPath = path.join(__dirname, '../../uploads', user.profile_pic);
                if (fs.existsSync(photoPath)) {
                    fs.unlinkSync(photoPath);
                }
            }

            await User.delete(req.params.id);
            res.json({
                success: true,
                message: "User berhasil dihapus"
            });
        } catch (err) {
            console.error('Error in deleteUser:', err);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    },

    // 7. Get User Statistics
    getUserStatistics: async (req, res) => {
        try {
            const stats = await User.getStatistics();
            res.json({
                success: true,
                data: stats
            });
        } catch (err) {
            console.error('Error in getUserStatistics:', err);
            res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }
};

module.exports = userController;