const libreService = require('../services/libreTranslateService');
const db = require('../database/db');

class TranslateController {
    async translate(req, res) {
        try {
            const { text, source, target, userId } = req.body;
            if (!text || !target || !userId) {
                return res.status(400).json({ success: false, error: 'text, target, userId requis' });
            }

            const src = source === 'auto' ? 'auto' : source;
            const result = await libreService.translate(text, src, target);

            const saved = await db.addTranslation(userId, {
                original: text,
                translated: result.translatedText,
                source: result.detectedLanguage || src,
                target
            });

            res.json({
                success: true,
                translation: result.translatedText,
                detectedLanguage: result.detectedLanguage,
                saved
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async getHistory(req, res) {
        try {
            const history = await db.getHistory(req.query.userId, 50);
            res.json({ success: true, history });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async getFavorites(req, res) {
        try {
            const favorites = await db.getFavorites(req.query.userId);
            res.json({ success: true, favorites });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async getStats(req, res) {
        try {
            const stats = await db.getStats(req.query.userId);
            res.json({ success: true, stats });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async clearHistory(req, res) {
        try {
            await db.clearHistory(req.query.userId);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async getLanguages(req, res) {
        try {
            const langs = await libreService.getLanguages();
            res.json({ success: true, languages: langs });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async getAllStats(req, res) {
        try {
            const stats = await db.getAllStats();
            res.json({ success: true, stats });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

module.exports = new TranslateController();