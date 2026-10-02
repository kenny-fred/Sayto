const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname);
const DB_FILE = path.join(DATA_DIR, 'translations.json');

class Database {
    constructor() {
        this.data = { users: {}, globalStats: { totalTranslations: 0 } };
    }

    async init() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(DB_FILE)) {
            try {
                this.data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
                return;
            } catch (e) {
                this.data = { users: {}, globalStats: { totalTranslations: 0 } };
            }
        }
        this.save();
    }

    save() {
        fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2));
    }

    ensureUser(userId) {
        if (!this.data.users[userId]) {
            this.data.users[userId] = {
                history: [],
                favorites: {},
                stats: {
                    totalTranslations: 0,
                    languagesUsed: {},
                    topFrequent: []
                }
            };
        }
        return this.data.users[userId];
    }

    async addTranslation(userId, translation) {
        const user = this.ensureUser(userId);
        const entry = {
            ...translation,
            timestamp: new Date().toISOString(),
            id: Date.now().toString(36) + Math.random().toString(36).substr(2)
        };

        user.history.unshift(entry);
        if (user.history.length > 100) user.history.pop();

        user.stats.totalTranslations++;
        this.data.globalStats.totalTranslations++;

        const langKey = `${translation.source}→${translation.target}`;
        user.stats.languagesUsed[langKey] = (user.stats.languagesUsed[langKey] || 0) + 1;

        const text = translation.original;
        user.favorites[text] = (user.favorites[text] || 0) + 1;

        this.updateTopFrequent(user);
        this.save();
        return entry;
    }

    updateTopFrequent(user) {
        const sorted = Object.entries(user.favorites)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([text, count]) => ({ text, count }));
        user.stats.topFrequent = sorted;
    }

    async getHistory(userId, limit = 50) {
        const user = this.data.users[userId];
        return user ? user.history.slice(0, limit) : [];
    }

    async getFavorites(userId) {
        const user = this.data.users[userId];
        if (!user) return [];
        return Object.entries(user.favorites)
            .sort((a, b) => b[1] - a[1])
            .map(([text, count]) => ({ text, count }));
    }

    async getStats(userId) {
        const user = this.data.users[userId];
        return user ? user.stats : { totalTranslations: 0, languagesUsed: {}, topFrequent: [] };
    }

    async clearHistory(userId) {
        if (this.data.users[userId]) {
            this.data.users[userId].history = [];
            this.save();
        }
    }

    async getAllStats() {
        const totalUsers = Object.keys(this.data.users).length;
        return {
            totalTranslations: this.data.globalStats.totalTranslations,
            totalUsers,
            users: this.data.users
        };
    }

    async getAllHistory() {
        let allHistory = [];
        Object.values(this.data.users).forEach(user => {
            allHistory = allHistory.concat(user.history);
        });
        return allHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    // ─── NOUVELLES MÉTHODES POUR L'AUTOCOMPLETE GLOBAL ───

    // Récupère l'historique de TOUS les utilisateurs (pas seulement un)
    async getGlobalVocabulary(limit = 500) {
        const allHistory = await this.getAllHistory();
        return allHistory.slice(0, limit);
    }

    // Calcule la fréquence de chaque mot sur l'ensemble des traductions
    async getGlobalWordFrequency() {
        const allHistory = await this.getAllHistory();
        const freq = {};

        allHistory.forEach(h => {
            const text = (h.original || '').toLowerCase();
            const words = text.split(/\s+/).filter(w => w.length > 1);
            words.forEach(w => {
                freq[w] = (freq[w] || 0) + 1;
            });
        });

        return freq;
    }

    // Calcule les bigrams globaux : pour chaque mot, quels mots suivent et combien de fois
    async getGlobalBigrams() {
        const allHistory = await this.getAllHistory();
        const bigrams = {};

        allHistory.forEach(h => {
            const text = (h.original || '').toLowerCase();
            const words = text.split(/\s+/).filter(w => w.length > 0);

            for (let i = 0; i < words.length - 1; i++) {
                const current = words[i];
                const next = words[i + 1];

                if (!bigrams[current]) bigrams[current] = {};
                bigrams[current][next] = (bigrams[current][next] || 0) + 1;
            }
        });

        return bigrams;
    }
}

module.exports = new Database();