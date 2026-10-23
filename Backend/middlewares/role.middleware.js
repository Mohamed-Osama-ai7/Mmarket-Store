exports.authorize = (...allowedRoles) => {
    return (req, res, next) => {
        // 1. Make sure the user is authenticated
        if (!req.user) {
            return res.status(401).json({
                message: "Authentication required"
            });
        }

        // 2. Make sure at least one role is provided
        if (
            allowedRoles.length === 0 ||
            !allowedRoles.includes(req.user.role)
        ) {
            return res.status(403).json({
                message: "Access denied"
            });
        }

        // 3. Continue if the user's role is allowed
        return next();
    };
};