const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

function createAuthMiddlewares(usersCollection, db) {
  const verifyToken = async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization || "";
      const bearerToken = authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]?.trim()
        : null;
      const headerEmail = req.headers["x-user-email"];
      const cookieToken = req.cookies?.token;

      if (!bearerToken && !headerEmail && !cookieToken) {
        return res
          .status(401)
          .send({ message: "Unauthorized: No token provided" });
      }

      const activeDb = db || req.app.locals.db;
      const betterAuthUserCol = activeDb ? activeDb.collection("user") : null;
      const betterAuthSessionCol = activeDb
        ? activeDb.collection("session")
        : null;

      let user = null;

      // ১. Better Auth 'session' কালেকশনে টোকেন চেক করো
      if (bearerToken && betterAuthSessionCol && betterAuthUserCol) {
        const sessionDoc = await betterAuthSessionCol.findOne({
          token: bearerToken,
        });

        if (sessionDoc?.userId) {
          const query = ObjectId.isValid(sessionDoc.userId)
            ? {
                $or: [
                  { _id: new ObjectId(sessionDoc.userId) },
                  { id: sessionDoc.userId },
                ],
              }
            : { id: sessionDoc.userId };
          user = await betterAuthUserCol.findOne(query);
        }

        // সরাসরি user.id পাঠানো হলে চেক করো
        if (!user) {
          const idQuery = ObjectId.isValid(bearerToken)
            ? {
                $or: [
                  { _id: new ObjectId(bearerToken) },
                  { id: bearerToken },
                ],
              }
            : { id: bearerToken };
          user = await betterAuthUserCol.findOne(idQuery);
        }
      }

      // ২. ইমেইল হেডার দিয়ে Better Auth 'user' বা 'users' কালেকশনে চেক করো
      if (!user && headerEmail) {
        if (betterAuthUserCol) {
          user = await betterAuthUserCol.findOne({ email: headerEmail });
        }
        if (!user && usersCollection) {
          user = await usersCollection.findOne({ email: headerEmail });
        }
      }

      // ৩. পুরোনো JWT কুকি ফলব্যাক
      if (!user && cookieToken) {
        const decoded = jwt.verify(
          cookieToken,
          process.env.ACCESS_TOKEN_SECRET
        );
        user =
          (betterAuthUserCol &&
            (await betterAuthUserCol.findOne({ email: decoded.email }))) ||
          (await usersCollection.findOne({ email: decoded.email }));
      }

      if (!user) {
        return res
          .status(401)
          .send({ message: "Unauthorized: Invalid session or user" });
      }

      if (user.isBlocked) {
        return res
          .status(403)
          .send({ message: "Your account has been blocked by admin." });
      }

      const normalizedId = user._id?.toString() || user.id;
      req.user = {
        ...user,
        _id: normalizedId,
        id: normalizedId,
        role: user.role || "customer",
      };

      next();
    } catch (error) {
      return res
        .status(401)
        .send({ message: "Unauthorized: Token verification failed" });
    }
  };

  const verifyAdmin = (req, res, next) => {
    if (req.user?.role !== "admin") {
      return res.status(403).send({ message: "Forbidden: Admin access only" });
    }
    next();
  };

  const verifyCustomer = (req, res, next) => {
    if (req.user?.role === "admin") {
      return res
        .status(403)
        .send({ message: "Forbidden: Customer account required" });
    }
    next();
  };

  return { verifyToken, verifyAdmin, verifyCustomer };
}

module.exports = createAuthMiddlewares;