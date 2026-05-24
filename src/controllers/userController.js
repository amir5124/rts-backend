const User = require('../models/userModel');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

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
        try {
            const id = req.params.id;
            const currentUser = await User.findById(id);

            if (!currentUser) {
                return res.status(404).json({
                    success: false,
                    message: "User tidak ditemukan"
                });
            }

            let profilePicPath = currentUser.profile_pic;

            // Logika jika ada file foto baru yang diunggah
            if (req.file) {
                profilePicPath = req.file.filename;

                // ✅ OPSI 2: Tidak menghapus file lama, hanya mengganti path di database
                // File lama akan tetap tersimpan di server (tidak masalah untuk storage kecil)
                console.log(`✅ New profile picture uploaded: ${req.file.filename}`);
                if (currentUser.profile_pic) {
                    console.log(`ℹ️ Old profile picture: ${currentUser.profile_pic} (kept as backup)`);
                }
            }

            const data = {
                name: req.body.name || currentUser.name,
                email: req.body.email || currentUser.email,
                phone: req.body.phone || currentUser.phone,
                profile_pic: profilePicPath
            };

            await User.update(id, data);

            // Return full URL untuk frontend
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const profilePicUrl = data.profile_pic
                ? `${baseUrl}/uploads/profiles/${data.profile_pic}`
                : null;

            res.json({
                success: true,
                message: "Profile berhasil diperbarui",
                data: {
                    id: parseInt(id),
                    name: data.name,
                    email: data.email,
                    phone: data.phone,
                    profile_pic: profilePicUrl
                }
            });

        } catch (err) {
            console.error('Error in updateUser:', err);
            res.status(500).json({
                success: false,
                message: err.message
            });
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