const jwt = require('jsonwebtoken');

const createAuthMiddlewares = (usersCollection) => {
  const verifyToken = async (req, res, next) => {
    try {
      const token = req.cookies?.token;
      if (!token) {
        return res.status(401).send({ message: 'Unauthorized: No token provided' });
      }

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      } catch (err) {
        return res.status(401).send({ message: 'Unauthorized: Invalid token' });
      }

      const dbUser = await usersCollection.findOne({ email: decoded.email });
      if (!dbUser) {
        return res.status(401).send({ message: 'User not found' });
      }
      if (dbUser.isBlocked) {
        return res.status(403).send({ message: 'Access denied: Your account is blocked' });
      }

      req.user = {
        _id: dbUser._id.toString(),
        email: dbUser.email,
        role: dbUser.role || 'customer',
        isBlocked: dbUser.isBlocked || false,
      };
      next();
    } catch (error) {
      res.status(500).send({ message: 'Authentication failed' });
    }
  };

  const verifyAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).send({ message: 'Forbidden: Admin access required' });
    }
    next();
  };

  const verifyCustomer = (req, res, next) => {
    if (req.user?.role !== 'customer') {
      return res.status(403).send({ message: 'Forbidden: Only customers can perform this action' });
    }
    next();
  };

  return { verifyToken, verifyAdmin, verifyCustomer };
};

module.exports = createAuthMiddlewares;