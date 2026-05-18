const User = require('../models/userModel');
const bcrypt = require('bcryptjs');
const fs = require('fs'); // Penting untuk menghapus foto lama jika diganti

const userController = {
    // 1. Ambil semua User
    getUsers: async (req, res) => {
        try {
            const [users] = await User.findAll();
            res.json(users);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // 2. Ambil User berdasarkan ID
    getUserById: async (req, res) => {
        try {
            const user = await User.findById(req.params.id);
            if (!user) return res.status(404).json({ message: "User tidak ditemukan" });

            // Jangan tampilkan password di response
            const { password, ...userData } = user;
            res.json(userData);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // 3. Edit Profile (Termasuk Foto)
    updateUser: async (req, res) => {
        try {
            const id = req.params.id;
            const currentUser = await User.findById(id);
            if (!currentUser) return res.status(404).json({ message: "User tidak ditemukan" });

            let profilePicPath = currentUser.profile_pic;

            // Logika jika ada file foto baru yang diunggah
            if (req.file) {
                profilePicPath = req.file.filename;

                // Hapus foto lama dari storage agar tidak menumpuk
                if (currentUser.profile_pic && fs.existsSync(`./uploads/${currentUser.profile_pic}`)) {
                    fs.unlinkSync(`./uploads/${currentUser.profile_pic}`);
                }
            }

            const data = {
                name: req.body.name || currentUser.name,
                email: req.body.email || currentUser.email,
                phone: req.body.phone || currentUser.phone,
                profile_pic: profilePicPath
            };

            await User.update(id, data);
            res.json({
                message: "Profile berhasil diperbarui",
                data: data
            });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // 4. Ganti Password (Khusus)
    changePassword: async (req, res) => {
        try {
            const id = req.params.id;
            const { oldPassword, newPassword } = req.body;

            const user = await User.findById(id);
            if (!user) return res.status(404).json({ message: "User tidak ditemukan" });

            // Validasi password lama
            const isMatch = await bcrypt.compare(oldPassword, user.password);
            if (!isMatch) return res.status(400).json({ message: "Password lama salah" });

            // Hash password baru
            const salt = await bcrypt.genSalt(10);
            const hashedStorePassword = await bcrypt.hash(newPassword, salt);

            await User.updatePassword(id, hashedStorePassword);
            res.json({ message: "Password berhasil diganti" });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // 5. Hapus User
    deleteUser: async (req, res) => {
        try {
            const user = await User.findById(req.params.id);
            if (user && user.profile_pic) {
                // Hapus file fisik jika user dihapus
                if (fs.existsSync(`./uploads/${user.profile_pic}`)) {
                    fs.unlinkSync(`./uploads/${user.profile_pic}`);
                }
            }

            await User.delete(req.params.id);
            res.json({ message: "User berhasil dihapus" });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

// Pastikan baris ini ada di paling bawah file controller!
module.exports = userController;