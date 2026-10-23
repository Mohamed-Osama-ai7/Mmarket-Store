const tryOnService = require('../service/tryon.service');
const logger = require('../utilities/logger');

exports.create = async (req, res) => {
    try {
        const data = await tryOnService.createProductToModelPrediction({
            slug: req.params.slug,
            audience: req.body?.audience,
            style: req.body?.style,
            userId: req.user?.id || req.user?._id
        });
        return res.status(202).json({ message: 'Virtual try-on generation started', data });
    } catch (error) {
        logger.logSafely('warn', 'Virtual try-on request failed', {
            event: 'tryon.create.failed', requestId: req.id, statusCode: error.statusCode || 500
        });
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Could not start virtual try-on' });
    }
};

exports.status = async (req, res) => {
    try {
        const data = await tryOnService.getProductToModelPrediction(req.params.predictionId, req.user?.id || req.user?._id);
        return res.status(200).json({ message: 'Virtual try-on status retrieved', data });
    } catch (error) {
        logger.logSafely('warn', 'Virtual try-on status request failed', {
            event: 'tryon.status.failed', requestId: req.id, statusCode: error.statusCode || 500
        });
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Could not retrieve virtual try-on status' });
    }
};
