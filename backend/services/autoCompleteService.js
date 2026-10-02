const db = require('../database/db');

class AutoCompleteService {
    // Vocabulaire global
    async getGlobalWords() {
        const freq = await db.getGlobalWordFrequency();
        return Object.keys(freq);
    }

    async getGlobalBigrams() {
        return await db.getGlobalBigrams();
    }

    // Suggestion en temps réel
    async suggestPhrase(userId, partialText) {
        const partial = partialText.toLowerCase().trim();
        if (partial.length < 2) return [];

        // 1. Historique global pour données riches
        const globalHistory = await db.getGlobalVocabulary(500);
        const userHistory = await db.getHistory(userId, 50);
        const allHistory = [...userHistory, ...globalHistory];

        const suggestions = new Map(); // phrase -> score

        // 2. Chercher les phrases qui COMMENCENT par le texte partiel
        allHistory.forEach(h => {
            const original = h.original.toLowerCase();
            const translated = h.translated.toLowerCase();

            // Original français
            if (original.startsWith(partial) && original.length > partial.length) {
                const completion = original.substring(partial.length).trim();
                const firstWord = completion.split(/\s+/)[0];
                if (firstWord) {
                    const phrase = partial + ' ' + firstWord;
                    suggestions.set(phrase, (suggestions.get(phrase) || 0) + 3);
                }
            }

            // Bigrams: "je t'" → chercher "je t'ai", "je t'aime", etc.
            const words = original.split(/\s+/);
            const partialWords = partial.split(/\s+/);
            const lastPartialWord = partialWords[partialWords.length - 1];

            for (let i = 0; i < words.length - 1; i++) {
                if (words[i].startsWith(lastPartialWord) || lastPartialWord.startsWith(words[i])) {
                    const nextWord = words[i + 1];
                    const phrase = partialWords.slice(0, -1).join(' ') + ' ' + words[i] + ' ' + nextWord;
                    if (phrase.startsWith(partial) && phrase.length > partial.length) {
                        suggestions.set(phrase, (suggestions.get(phrase) || 0) + 2);
                    }
                }
            }
        });

        // 3. Bigrams globaux pour prédiction mot suivant
        const bigrams = await this.getGlobalBigrams();
        const partialWords = partial.split(/\s+/);
        const lastWord = partialWords[partialWords.length - 1];

        if (bigrams[lastWord]) {
            Object.entries(bigrams[lastWord])
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .forEach(([nextWord, count]) => {
                    const phrase = partial + ' ' + nextWord;
                    suggestions.set(phrase, (suggestions.get(phrase) || 0) + count);
                });
        }

        // 4. Si le dernier mot est incomplet, chercher des completions
        if (lastWord.length >= 2) {
            const allWords = await this.getGlobalWords();
            allWords.filter(w => w.startsWith(lastWord) && w !== lastWord)
                .slice(0, 3)
                .forEach(w => {
                    const phrase = partialWords.slice(0, -1).join(' ') + ' ' + w;
                    suggestions.set(phrase, (suggestions.get(phrase) || 0) + 1);
                });
        }

        // 5. Convertir et trier
        return Array.from(suggestions.entries())
            .map(([phrase, score]) => ({ phrase, score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
    }

    // Suggestion de mots suivant (après espace)
    async predictNextWord(userId, textBeforeCursor) {
        const words = textBeforeCursor.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
        if (words.length === 0) return [];

        const lastTwo = words.slice(-2); // derniers 2 mots pour contexte
        const lastWord = words[words.length - 1];

        const bigrams = await this.getGlobalBigrams();
        const predictions = new Map();

        // Prédiction basée sur le dernier mot
        if (bigrams[lastWord]) {
            Object.entries(bigrams[lastWord]).forEach(([next, count]) => {
                predictions.set(next, (predictions.get(next) || 0) + count * 2);
            });
        }

        // Prédiction basée sur les 2 derniers mots (trigrams approximés)
        if (words.length >= 2) {
            const history = await db.getGlobalVocabulary(300);
            history.forEach(h => {
                const hWords = h.original.toLowerCase().split(/\s+/);
                for (let i = 0; i < hWords.length - 2; i++) {
                    if (hWords[i] === lastTwo[0] && hWords[i + 1] === lastTwo[1]) {
                        const next = hWords[i + 2];
                        predictions.set(next, (predictions.get(next) || 0) + 3);
                    }
                }
            });
        }

        return Array.from(predictions.entries())
            .map(([word, score]) => ({ word, score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
    }
}

module.exports = new AutoCompleteService();