const mongoose = require('mongoose');
const fs = require('node:fs/promises');
const path = require('node:path');
const Product = require('../model/product.model');
const TryOnJob = require('../model/tryon-job.model');
const logger = require('../utilities/logger');

const uploadDirectory = path.resolve(__dirname, '../uploads');
const predictionIdPattern = /^[A-Za-z0-9-]{20,120}$/;
const allowedStyles = {
    studio: 'clean premium fashion studio, soft neutral background, full-body editorial catalogue photograph',
    minimal: 'minimalist contemporary fashion catalogue, soft daylight, simple architectural background, full-body composition',
    streetwear: 'tasteful modern streetwear editorial, refined urban backdrop, natural stance, full-body fashion photograph'
};

function serviceError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function detectImageMime(buffer) {
    if (!Buffer.isBuffer(buffer)) return null;
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    return null;
}

async function requestJson(url, options, timeoutMs = 20000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            logger.logSafely('warn', 'Virtual try-on provider returned a non-success status', {
                event: 'tryon.provider.http_error', statusCode: response.status
            });
            throw serviceError(response.status === 401 ? 'Virtual try-on provider credentials are invalid' : 'The virtual try-on service is temporarily unavailable', response.status === 429 ? 429 : 502);
        }
        return payload;
    } catch (error) {
        if (error.statusCode) throw error;
        if (error.name === 'AbortError') throw serviceError('The virtual try-on provider timed out. Please try again.', 504);
        logger.logSafely('warn', 'Virtual try-on provider request failed', { event: 'tryon.provider.request_failed' });
        throw serviceError('The virtual try-on service could not be reached. Please try again later.', 502);
    } finally {
        clearTimeout(timeout);
    }
}

async function getProductImageDataUri(product) {
    const candidates = [...new Set([product?.imgURL, ...(Array.isArray(product?.images) ? product.images : [])].filter(Boolean))];
    for (const filename of candidates) {
        if (typeof filename !== 'string' || path.basename(filename) !== filename || filename === '.' || filename === '..') continue;
        const imagePath = path.resolve(uploadDirectory, filename);
        if (!imagePath.startsWith(`${uploadDirectory}${path.sep}`)) continue;
        try {
            const buffer = await fs.readFile(imagePath);
            // Catalogue files are limited to 2 MiB at upload; keep a firm bound for legacy files too.
            if (buffer.length > 2 * 1024 * 1024) continue;
            const mime = detectImageMime(buffer);
            if (!mime) continue;
            return `data:${mime};base64,${buffer.toString('base64')}`;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    throw serviceError('This product does not have a supported local image for virtual try-on', 422);
}

exports.createProductToModelPrediction = async ({ slug, audience, style, userId }) => {
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) throw serviceError('Authentication is required for virtual try-on', 401);
    const apiKey = process.env.FASHN_API_KEY;
    if (!apiKey || !apiKey.trim()) throw serviceError('Virtual fitting is not configured on this server yet. Contact the store administrator.', 503);

    const targetModel = String(audience || '').toLowerCase();
    if (!['male', 'female'].includes(targetModel)) throw serviceError('Choose a male or female model', 400);
    const selectedStyle = Object.prototype.hasOwnProperty.call(allowedStyles, style) ? style : 'studio';
    if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,180}$/.test(slug)) throw serviceError('Invalid product slug', 400);

    const product = await Product.findOne({ slug, isActive: true }).select('name imgURL images audience garmentType').lean();
    if (!product) throw serviceError('Product not found', 404);
    if (product.garmentType === 'accessories') throw serviceError('Virtual try-on is available for clothing products, not accessories.', 422);

    const productImage = await getProductImageDataUri(product);
    const prompt = `Create a realistic full-body fashion catalogue photograph of an adult ${targetModel} model wearing the supplied product. Preserve the garment's actual design, main colors, pattern, and visible details as faithfully as possible. Keep styling tasteful, with a natural pose and realistic proportions. ${allowedStyles[selectedStyle]}. Do not add text, logos, accessories, or garments that are not in the product image.`;
    const payload = await requestJson('https://api.fashn.ai/v1/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model_name: 'product-to-model',
            inputs: {
                product_image: productImage,
                prompt,
                aspect_ratio: '3:4',
                resolution: '1k',
                generation_mode: 'fast',
                num_images: 1,
                output_format: 'jpeg',
                return_base64: true
            }
        })
    });
    if (typeof payload.id !== 'string' || !predictionIdPattern.test(payload.id)) {
        throw serviceError('The virtual try-on service returned an invalid job identifier', 502);
    }
    await TryOnJob.create({ predictionId: payload.id, user: userId, productSlug: slug, expiresAt: new Date(Date.now() + 55 * 60 * 1000) });
    return { predictionId: payload.id, status: 'starting', productName: product.name };
};

exports.getProductToModelPrediction = async (predictionId, userId) => {
    const apiKey = process.env.FASHN_API_KEY;
    if (!apiKey || !apiKey.trim()) throw serviceError('Virtual fitting is not configured on this server yet. Contact the store administrator.', 503);
    if (typeof predictionId !== 'string' || !predictionIdPattern.test(predictionId)) throw serviceError('Invalid virtual try-on job identifier', 400);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) throw serviceError('Authentication is required for virtual try-on', 401);
    const ownedJob = await TryOnJob.findOne({ predictionId, user: userId, expiresAt: { $gt: new Date() } }).select('_id').lean();
    if (!ownedJob) throw serviceError('Virtual try-on job not found or no longer available', 404);
    const payload = await requestJson(`https://api.fashn.ai/v1/status/${encodeURIComponent(predictionId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey.trim()}` }
    });
    const allowedStatuses = ['starting', 'in_queue', 'processing', 'completed', 'failed'];
    if (!allowedStatuses.includes(payload.status)) throw serviceError('The virtual try-on service returned an unknown status', 502);
    let image = null;
    if (payload.status === 'completed') {
        image = Array.isArray(payload.output) ? payload.output[0] : null;
        if (typeof image !== 'string' || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 16 * 1024 * 1024) {
            throw serviceError('The generated preview could not be validated. Please try again.', 502);
        }
    }
    if (payload.status === 'failed') throw serviceError('The virtual fitting preview could not be generated for this image. Try another product photo.', 422);
    return { predictionId, status: payload.status, image };
};
