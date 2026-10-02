const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/translateController');
const autoComplete = require('../services/autoCompleteService');

router.post('/', ctrl.translate);
router.get('/history', ctrl.getHistory);
router.get('/favorites', ctrl.getFavorites);
router.get('/stats', ctrl.getStats);
router.delete('/history', ctrl.clearHistory);
router.get('/languages', ctrl.getLanguages);
router.get('/admin/stats', ctrl.getAllStats);

router.get('/check-duplicate', async (req, res) => {
    try {
        const { userId, text, source, target } = req.query;
        const db = require('../database/db');
        const history = await db.getHistory(userId, 100);
        const normalizedText = text.trim().toLowerCase();
        
        const duplicate = history.find(h => 
            h.original.trim().toLowerCase() === normalizedText &&
            h.source === source &&
            h.target === target
        );
        
        res.json({ success: true, found: !!duplicate, translation: duplicate || null });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/suggest-phrase', async (req, res) => {
    try {
        const { q, userId } = req.query;
        if (!q || !userId) {
            return res.status(400).json({ success: false, error: 'q et userId requis' });
        }
        const suggestions = await autoComplete.suggestPhrase(userId, q);
        res.json({ success: true, suggestions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/predict', async (req, res) => {
    try {
        const { text, userId } = req.query;
        if (!text || !userId) {
            return res.status(400).json({ success: false, error: 'text et userId requis' });
        }
        const predictions = await autoComplete.predictNextWord(userId, text);
        res.json({ success: true, predictions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;