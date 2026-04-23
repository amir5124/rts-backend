const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) return res.status(403).json({ message: "Token diperlukan" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Berisi id, role, dll
        next();
    } catch (err) {
        return res.status(401).json({ message: "Token tidak valid" });
    }
};

module.exports = verifyToken;