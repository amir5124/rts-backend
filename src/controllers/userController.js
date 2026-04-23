const User = require('../models/userModel');
const bcrypt = require('bcryptjs');

exports.getUsers = async (req, res) => {
    try {
        const [users] = await User.findAll();
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.getUserById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: "User tidak ditemukan" });
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.updateUser = async (req, res) => {
    try {
        const id = req.params.id;
        const currentUser = await User.findById(id);
        if (!currentUser) return res.status(404).json({ message: "User tidak ditemukan" });

        const data = {
            name: req.body.name || currentUser.name,
            email: req.body.email || currentUser.email,
            phone: req.body.phone || currentUser.phone,
            profile_pic: req.file ? req.file.path : currentUser.profile_pic
        };

        await User.update(id, data);
        res.json({ message: "User berhasil diperbarui" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        await User.delete(req.params.id);
        res.json({ message: "User berhasil dihapus" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};