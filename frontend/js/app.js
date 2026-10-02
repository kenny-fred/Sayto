const API_URL = window.location.origin + '/api';

function generateUserId() {
    const stored = localStorage.getItem('translatehci_userid');
    if (stored) return stored;

    const components = [
        navigator.userAgent.slice(0, 20).replace(/\W/g, ''),
        navigator.platform.replace(/\W/g, ''),
        new Date().getTime().toString(36),
        Math.random().toString(36).slice(2, 6)
    ];

    const base = components.join('').toLowerCase();
    const hash = Array.from(base).reduce((h, c) => {
        h = ((h << 5) - h) + c.charCodeAt(0);
        return h & h;
    }, 0).toString(16).replace('-', '');

    const randomKey = Array.from({length: 8}, () => 
        '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)]
    ).join('');

    const userId = `${hash.slice(0, 8)}-${randomKey}`;
    localStorage.setItem('translatehci_userid', userId);
    return userId;
}

function getDeviceType() {
    const ua = navigator.userAgent;
    if (/iPad|Tablet/i.test(ua)) return 'Tablette';
    if (/Mobile|Android|iPhone/i.test(ua)) return 'Télephone';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'PC Windows';
    return 'Ordinateur';
}

const USER_ID = generateUserId();

const ERROR_MESSAGES = {
    'TypeError: Failed to fetch': {
        title: 'Impossible de contacter le serveur',
        solution: 'Verifiez que le serveur backend est démarré',
        action: 'Reessayer'
    },
    500: {
        title: 'Le service de traduction est indisponible',
        solution: 'Nous sommes entrain de resoudre le probleme. Veuillez reessayer plus tard.',
        action: "Verifier l'etat"
    },
    404: {
        title: 'Service non trouvé',
        solution: "Verifiez la configuration du serveur.",
        action: null
    },
    429: {
        title: 'Trop de requetes',
        solution: 'Attendez quelques secondes.',
        action: 'Reessayer dans 5s'
    },
    403: {
        title: 'Acces refusé',
        solution: "Vous n'avez pas les permissions nécessaires pour cette action.",
        action: null
    }
};

// ============ APP ============
class TranslateApp {
    constructor() {
        this.inputText = document.getElementById('input-text');
        this.outputText = document.getElementById('output-text');
        this.sourceLang = document.getElementById('source-lang');
        this.targetLang = document.getElementById('target-lang');
        this.translateBtn = document.getElementById('translate-btn');
        this.charCount = document.getElementById('char-count');
        this.userIdDisplay = document.getElementById('user-id');
        this.toastContainer = document.getElementById('toast-container');
        this.listeningIndicator = document.getElementById('listening-indicator');
        this.onboardingContainer = document.getElementById('onboarding-container');
        this.duplicateModal = document.getElementById('duplicate-modal');
        this.helpBtn = document.getElementById('help-btn');
        this.logoBtn = document.getElementById('logo-btn');

        this.voiceService = new VoiceService();
        this.voiceBtn = document.getElementById('voice-btn');

        this.suggestionBox = null;
        this.debounceTimer = null;
        this.undoStack = [];
        this.maxUndoSize = 10;

        this.contextGlossary = {
            'regle': { en: 'ruler', context: 'school' },
            'regles': { en: 'rules', context: 'general' },
            'ma regle': { en: 'my ruler', context: 'school' },
            'crayon': { en: 'pencil', context: 'school' },
            'gomme': { en: 'eraser', context: 'school' },
            'cartable': { en: 'schoolbag', context: 'school' }
        };

        this.expertMode = localStorage.getItem('sayto_expert') === 'true';
        this.debounceDelay = this.expertMode ? 100 : 200;
        this.hasSeenOnboarding = localStorage.getItem('sayto_onboarding') === 'true';
        this.historyCache = [];

        // Rating system
        this.ratingModal = null;
        this.saytoNavModal = null;
        this.lastRatingDate = localStorage.getItem('sayto_last_rating');
        this.hasRated = localStorage.getItem('sayto_has_rated') === 'true';

        this.init();
    }

    init() {
        console.log('Init SayTo, userId:', USER_ID);

        if (this.userIdDisplay) {
            const deviceType = getDeviceType();
            this.userIdDisplay.textContent = `${deviceType}`;
            this.userIdDisplay.title = `ID: ${USER_ID}`;
        }

        this.translateBtn.addEventListener('click', () => this.translate());
        document.getElementById('swap-btn').addEventListener('click', () => this.swap());
        document.getElementById('clear-btn').addEventListener('click', () => this.clear());
        document.getElementById('copy-btn').addEventListener('click', () => this.copy());

        if (this.helpBtn) {
            this.helpBtn.addEventListener('click', () => this.showOnboarding(true));
        }

        if (this.logoBtn) {
            this.logoBtn.addEventListener('click', () => this.showSaytoNav());
        }

        this.inputText.addEventListener('input', () => this.handleInputValidation());

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        this.initVoice();
        this.initAutoComplete();
        this.initRatingSystem();

        document.addEventListener('keydown', (e) => this.handleGlobalShortcuts(e));

        this.loadHistory();
        this.loadFavorites();
        this.loadStats();
        this.checkHealth();

        if (!this.hasSeenOnboarding) {
            setTimeout(() => this.showOnboarding(), 1500);
        }

        // Vérifier si rating obligatoire nécessaire
        this.checkForcedRating();

        window.addEventListener('online', () => this.toast('Connexion retablie', 'success'));
        window.addEventListener('offline', () => this.toast('Mode hors ligne', 'warning'));
    }

    // ========== RATING SYSTEM ==========
    initRatingSystem() {
        this.ratingModal = document.getElementById('rating-modal');
        this.saytoNavModal = document.getElementById('sayto-nav-modal');

        // Boutons du nav modal
        const navRateBtn = document.getElementById('nav-rate-btn');
        const navSuggestBtn = document.getElementById('nav-suggest-btn');
        const navCloseBtn = document.getElementById('sayto-nav-close');

        if (navRateBtn) navRateBtn.addEventListener('click', () => {
            this.hideSaytoNav();
            this.showRatingModal();
        });

        if (navSuggestBtn) navSuggestBtn.addEventListener('click', () => {
            this.hideSaytoNav();
            this.showRatingModal();
        });

        if (navCloseBtn) navCloseBtn.addEventListener('click', () => this.hideSaytoNav());

        // Boutons du rating modal
        const ratingClose = document.getElementById('rating-close');
        const ratingCancel = document.getElementById('rating-cancel');
        const ratingSubmit = document.getElementById('rating-submit');
        const ratingSlider = document.getElementById('rating-slider');

        if (ratingClose) ratingClose.addEventListener('click', () => this.hideRatingModal());
        if (ratingCancel) ratingCancel.addEventListener('click', () => this.hideRatingModal());

        if (ratingSlider) {
            ratingSlider.addEventListener('input', (e) => this.updateRatingDisplay(e.target.value));
        }

        if (ratingSubmit) {
            ratingSubmit.addEventListener('click', () => this.submitRating());
        }

        // Fermer modals en cliquant sur le backdrop
        this.ratingModal?.addEventListener('click', (e) => {
            if (e.target === this.ratingModal && !this.ratingModal.classList.contains('forced')) {
                this.hideRatingModal();
            }
        });

        this.saytoNavModal?.addEventListener('click', (e) => {
            if (e.target === this.saytoNavModal) this.hideSaytoNav();
        });
    }

    showSaytoNav() {
        if (this.saytoNavModal) {
            this.saytoNavModal.classList.add('active');
        }
    }

    hideSaytoNav() {
        if (this.saytoNavModal) {
            this.saytoNavModal.classList.remove('active');
        }
    }

    showRatingModal(forced = false) {
        if (!this.ratingModal) return;

        // Réinitialiser le formulaire
        const slider = document.getElementById('rating-slider');
        const comment = document.getElementById('rating-comment');
        const suggestion = document.getElementById('rating-suggestion');

        if (slider) {
            slider.value = 10;
            this.updateRatingDisplay(10);
        }
        if (comment) comment.value = '';
        if (suggestion) suggestion.value = '';

        if (forced) {
            this.ratingModal.classList.add('forced');
            // Masquer le bouton annuler en mode forcé
            const cancelBtn = document.getElementById('rating-cancel');
            if (cancelBtn) cancelBtn.style.display = 'none';
        } else {
            this.ratingModal.classList.remove('forced');
            const cancelBtn = document.getElementById('rating-cancel');
            if (cancelBtn) cancelBtn.style.display = 'inline-flex';
        }

        this.ratingModal.classList.add('active');
    }

    hideRatingModal() {
        if (this.ratingModal) {
            this.ratingModal.classList.remove('active');
        }
    }

    updateRatingDisplay(value) {
        const valueDisplay = document.getElementById('rating-value');
        const starsContainer = document.getElementById('rating-stars-display');

        if (valueDisplay) valueDisplay.textContent = value;

        if (starsContainer) {
            const numStars = 5;
            const filledStars = (value / 20) * numStars;
            let starsHtml = '';

            for (let i = 1; i <= numStars; i++) {
                if (i <= filledStars) {
                    starsHtml += '<span class="rating-star filled">★</span>';
                } else if (i - 0.5 <= filledStars) {
                    starsHtml += '<span class="rating-star half">★</span>';
                } else {
                    starsHtml += '<span class="rating-star">★</span>';
                }
            }
            starsContainer.innerHTML = starsHtml;
        }
    }

    async submitRating() {
        const slider = document.getElementById('rating-slider');
        const comment = document.getElementById('rating-comment');
        const suggestion = document.getElementById('rating-suggestion');
        const submitBtn = document.getElementById('rating-submit');

        const score = parseInt(slider?.value || 10);
        const commentText = comment?.value.trim() || '';
        const suggestionText = suggestion?.value.trim() || '';

        // Validation: commentaire obligatoire
        if (!commentText) {
            this.toast('Le commentaire est obligatoire !', 'error');
            comment?.focus();
            return;
        }

        if (submitBtn) submitBtn.disabled = true;

        try {
            const res = await fetch(`${API_URL}/reviews`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: USER_ID,
                    score: score,
                    comment: commentText,
                    suggestion: suggestionText || null
                })
            });

            const data = await res.json();

            if (data.success) {
                this.toast('Merci pour votre avis ! ⭐', 'success');
                localStorage.setItem('sayto_has_rated', 'true');
                localStorage.setItem('sayto_last_rating', Date.now().toString());
                this.hasRated = true;
                this.lastRatingDate = Date.now().toString();
                this.hideRatingModal();
            } else {
                this.toast(data.error || 'Erreur lors de l\'envoi', 'error');
            }
        } catch (err) {
            console.error('Erreur envoi avis:', err);
            this.toast('Erreur de connexion', 'error');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    checkForcedRating() {
        // Si l'utilisateur n'a jamais noté, forcer immédiatement
        if (!this.hasRated) {
            setTimeout(() => this.showRatingModal(true), 30*60000);
            return;
        }

        // Vérifier si 1 semaine s'est écoulée depuis la dernière notation
        if (this.lastRatingDate) {
            const oneWeek = 7 * 24 * 60 * 60 * 1000;
            const lastDate = parseInt(this.lastRatingDate);
            const now = Date.now();

            if (now - lastDate >= oneWeek) {
                setTimeout(() => this.showRatingModal(true), 3000);
            }
        }
    }

    // ========== H5: VALIDATION EN TEMPS REEL ==========
    handleInputValidation() {
        const length = this.inputText.value.length;
        const maxLength = 5000;

        this.charCount.textContent = `${length} / ${maxLength}`;

        if (length >= maxLength) {
            this.charCount.classList.add('danger');
            this.charCount.classList.remove('warning');
            this.inputText.value = this.inputText.value.substring(0, maxLength);
            this.toast('Limite de 5000 caracteres atteinte', 'warning');
        } else if (length > maxLength * 0.6) {
            this.charCount.classList.add('warning');
            this.charCount.classList.remove('danger');
        } else {
            this.charCount.classList.remove('warning', 'danger');
        }

        const hasText = length > 0 && length <= maxLength;
        this.translateBtn.disabled = !hasText;
        this.translateBtn.style.opacity = hasText ? '1' : '0.5';
    }

    // ========== H7: RACCOURCIS CLAVIER ==========
    handleGlobalShortcuts(e) {
        const isInput = e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT';

        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            this.translate();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            this.swap();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.undo();
            return;
        }

        if (!isInput && e.key === 'v') {
            e.preventDefault();
            this.voiceService.start();
            return;
        }

        if (e.key === '?' && e.shiftKey) {
            e.preventDefault();
            this.showOnboarding(true);
            return;
        }

        if (e.key === 'Escape') {
            this.hideSuggestions();
            this.hideDuplicateModal();
            this.hideSaytoNav();
            if (!this.ratingModal?.classList.contains('forced')) {
                this.hideRatingModal();
            }
            document.querySelectorAll('.error-modal, .help-overlay').forEach(el => el.remove());
        }
    }

    // ========== H1: VOICE ==========
    initVoice() {
        if (!this.voiceService.isSupported()) {
            this.voiceBtn.style.display = 'none';
            console.log('Voice-to-Text non supporte');
            return;
        }

        this.voiceService.onStart = () => {
            this.voiceBtn.classList.add('listening');
            this.voiceBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" class="pulse"/>
                    <circle cx="12" cy="12" r="3" fill="currentColor"/>
                </svg>
            `;
            this.inputText.placeholder = 'Parlez maintenant...';
            this.listeningIndicator.classList.add('active');
            this.toast('Ecoute en cours', 'info');
        };

        this.voiceService.onEnd = () => {
            this.voiceBtn.classList.remove('listening');
            this.voiceBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
            `;
            this.inputText.placeholder = 'Entrez votre texte ou cliquez sur le micro...';
            this.listeningIndicator.classList.remove('active');
        };

        this.voiceService.onResult = (result) => {
            if (result.interim) {
                this.inputText.value = result.interim;
                this.inputText.style.color = 'var(--text-secondary)';
            }

            if (result.final) {
                this.inputText.value = result.final;
                this.inputText.style.color = 'var(--text-primary)';
                this.inputText.dispatchEvent(new Event('input'));
                this.toast('Dictee terminee', 'success');
            }
        };

        this.voiceService.onError = (error) => {
            this.toast(error, 'error');
            this.voiceService.onEnd();
        };

        this.voiceBtn.addEventListener('click', () => {
            this.voiceService.start();
        });

        navigator.permissions?.query({ name: 'microphone' }).then(result => {
            if (result.state === 'prompt') {
                this.showPermissionPrompt();
            }
        });
    }

    showPermissionPrompt() {
        const toast = document.createElement('div');
        toast.className = 'permission-toast';
        toast.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2"/>
            </svg>
            <span>Autorisez l'acces au micro pour la dictée vocale</span>
            <button class="text-btn" onclick="this.parentElement.remove()">OK</button>
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }

    // ========== AUTO-COMPLETE ==========
    initAutoComplete() {
        this.suggestionBox = document.createElement('div');
        this.suggestionBox.className = 'suggestions';
        this.suggestionBox.style.display = 'none';

        this.inputText.parentNode.style.position = 'relative';
        this.inputText.parentNode.appendChild(this.suggestionBox);

        this.inputText.addEventListener('input', (e) => {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => this.handleInput(e), this.debounceDelay);
        });

        this.inputText.addEventListener('keydown', (e) => this.handleKeydown(e));

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.suggestions') && e.target !== this.inputText) {
                this.hideSuggestions();
            }
        });
    }

    async handleInput(e) {
        const text = this.inputText.value;
        const cursorPos = this.inputText.selectionStart;
        const beforeCursor = text.substring(0, cursorPos);

        if (cursorPos < text.length * 0.9) {
            this.hideSuggestions();
            return;
        }

        const lastChar = beforeCursor.slice(-1);
        const words = beforeCursor.trim().split(/\s+/);

        if (words.length === 0 || (words[words.length - 1].length < 2 && lastChar !== ' ')) {
            this.hideSuggestions();
            return;
        }

        try {
            let suggestions = [];

            if (lastChar === ' ') {
                const res = await fetch(
                    `${API_URL}/translate/predict?text=${encodeURIComponent(beforeCursor.trim())}&userId=${USER_ID}`
                );
                const data = await res.json();
                if (data.success) {
                    suggestions = data.predictions.map(p => ({
                        type: 'word',
                        display: p.word,
                        full: beforeCursor + p.word,
                        score: p.score
                    }));
                }
            } else {
                const res = await fetch(
                    `${API_URL}/translate/suggest-phrase?q=${encodeURIComponent(beforeCursor.trim())}&userId=${USER_ID}`
                );
                const data = await res.json();
                if (data.success) {
                    suggestions = data.suggestions.map(s => ({
                        type: 'phrase',
                        display: s.phrase,
                        full: s.phrase,
                        score: s.score
                    }));
                }
            }

            if (suggestions.length > 0) {
                this.showSuggestions(suggestions, beforeCursor);
            } else {
                this.hideSuggestions();
            }
        } catch (err) {
            this.hideSuggestions();
        }
    }

    showContextualSuggestion(original, betterTranslation) {
        const toast = document.createElement('div');
        toast.className = 'context-toast';
        toast.innerHTML = `
            <div class="context-toast-content">
                <span class="context-icon">💡</span>
                <div class="context-text">
                    <p><strong>Suggestion contextuelle</strong></p>
                    <p>"${original}" se traduit mieux par :</p>
                    <p class="context-suggestion">"${betterTranslation}"</p>
                </div>
                <button class="context-btn" onclick="app.applyBetterTranslation('${betterTranslation}', this)">Utiliser</button>
            </div>
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 8000);
    }

    applyBetterTranslation(translation, btn) {
        this.outputText.value = translation;
        this.toast('Traduction amelioree appliquee', 'success');
        btn.closest('.context-toast').remove();
    }

    showSuggestions(suggestions, currentText) {
        const lineHeight = 24;
        const lines = currentText.split('\n').length;

        this.suggestionBox.innerHTML = suggestions.map((s, i) => {
            const newPart = s.display.substring(currentText.trim().length).trim();
            const existingPart = currentText.trim();

            return `
                <div class="suggestion-item ${i === 0 ? 'active' : ''}" data-full="${this.escape(s.full)}" data-type="${s.type}">
                    <span class="suggestion-text">
                        <span class="suggestion-existing">${this.escape(existingPart)}</span>
                        <span class="suggestion-new">${this.escape(newPart || s.display)}</span>
                    </span>
                    <span class="suggestion-score">${s.score}</span>
                </div>
            `;
        }).join('');

        this.suggestionBox.style.display = 'block';
        this.suggestionBox.style.top = `${lines * lineHeight + 8}px`;

        this.suggestionBox.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                this.applySuggestion(item.dataset.full, item.dataset.type);
            });
        });
    }

    applySuggestion(fullText, type) {
        const cursorPos = this.inputText.selectionStart;
        const text = this.inputText.value;
        const beforeCursor = text.substring(0, cursorPos);
        const wordsBefore = beforeCursor.trim().split(/\s+/);
        const wordsSuggestion = fullText.trim().split(/\s+/);

        const commonLength = this.findCommonPrefixLength(wordsBefore, wordsSuggestion);
        const newBefore = wordsSuggestion.slice(0, Math.max(commonLength + 1, wordsSuggestion.length)).join(' ');

        const afterCursor = text.substring(cursorPos);
        this.inputText.value = newBefore + (afterCursor.startsWith(' ') || afterCursor.length === 0 ? '' : ' ') + afterCursor;

        const newPos = newBefore.length;
        this.inputText.setSelectionRange(newPos, newPos);
        this.inputText.focus();

        this.hideSuggestions();
        this.inputText.dispatchEvent(new Event('input'));
    }

    findCommonPrefixLength(arr1, arr2) {
        let i = 0;
        while (i < arr1.length && i < arr2.length && arr1[i] === arr2[i]) {
            i++;
        }
        return i;
    }

    handleKeydown(e) {
        if (this.suggestionBox.style.display === 'none') return;

        const items = this.suggestionBox.querySelectorAll('.suggestion-item');
        const active = this.suggestionBox.querySelector('.active');
        let index = Array.from(items).indexOf(active);

        if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            if (active) {
                this.applySuggestion(active.dataset.full, active.dataset.type);
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            items[index]?.classList.remove('active');
            index = (index + 1) % items.length;
            items[index]?.classList.add('active');
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            items[index]?.classList.remove('active');
            index = index <= 0 ? items.length - 1 : index - 1;
            items[index]?.classList.add('active');
            return;
        }

        if (e.key === 'Escape') {
            this.hideSuggestions();
        }

        if (e.key === ' ' && active) {
            setTimeout(() => this.handleInput(e), 50);
        }
    }

    hideSuggestions() {
        this.suggestionBox.style.display = 'none';
    }

    // ========== VERIFICATION DOUBLON ==========
    async checkDuplicateInHistory(text, source, target) {
        const normalizedText = text.trim().toLowerCase();
        const cachedDuplicate = this.historyCache.find(h => 
            h.original.trim().toLowerCase() === normalizedText &&
            h.source === source &&
            h.target === target
        );

        if (cachedDuplicate) {
            return cachedDuplicate;
        }

        try {
            const res = await fetch(`${API_URL}/translate/check-duplicate?userId=${USER_ID}&text=${encodeURIComponent(text)}&source=${source}&target=${target}`);
            const data = await res.json();
            if (data.success && data.found) {
                return data.translation;
            }
        } catch (e) {
            console.log('Erreur vérification doublon:', e);
        }

        return null;
    }

    showDuplicateModal(duplicate) {
        const modal = this.duplicateModal;
        const translationDiv = document.getElementById('duplicate-translation');

        translationDiv.innerHTML = `
            <div class="dup-original">${this.escape(duplicate.original)}</div>
            <div class="dup-result">${this.escape(duplicate.translated)}</div>
        `;

        document.getElementById('duplicate-use-btn').onclick = () => {
            this.inputText.value = duplicate.original;
            this.outputText.value = duplicate.translated;
            this.sourceLang.value = duplicate.source;
            this.targetLang.value = duplicate.target;
            this.inputText.dispatchEvent(new Event('input'));
            this.hideDuplicateModal();
            this.toast('Traduction restaurée depuis l\'historique', 'success');
            this.showRestoreIndicator();
        };

        modal.classList.add('active');
    }

    hideDuplicateModal() {
        this.duplicateModal.classList.remove('active');
    }

    showRestoreIndicator() {
        this.inputText.parentElement.classList.add('history-restore-flash');
        this.outputText.parentElement.classList.add('history-restore-flash');

        setTimeout(() => {
            this.inputText.parentElement.classList.remove('history-restore-flash');
            this.outputText.parentElement.classList.remove('history-restore-flash');
        }, 600);
    }

    // ========== TRANSLATE ==========
    async translate() {
        const text = this.inputText.value.trim();

        if (!text) {
            this.toast('Entrez du texte a traduire', 'error');
            this.inputText.focus();
            return;
        }

        if (!navigator.onLine) {
            this.toast('Vous etes hors ligne. Verifiez votre connexion.', 'error');
            return;
        }

        if (text.length > 5000) {
            this.toast('Texte trop long (max 5000 caracteres)', 'error');
            return;
        }

        const duplicate = await this.checkDuplicateInHistory(
            text, 
            this.sourceLang.value, 
            this.targetLang.value
        );

        if (duplicate) {
            this.showDuplicateModal(duplicate);
            return;
        }

        const lastTranslation = this.undoStack[this.undoStack.length - 1];
        if (lastTranslation && lastTranslation.input === text && 
            lastTranslation.source === this.sourceLang.value &&
            lastTranslation.target === this.targetLang.value) {
            this.toast('Cette traduction existe deja dans la session actuelle', 'info');
            return;
        }

        this.performTranslation();
    }

    async performTranslation() {
        const text = this.inputText.value.trim();

        this.saveStateForUndo({
            input: this.inputText.value,
            output: this.outputText.value,
            source: this.sourceLang.value,
            target: this.targetLang.value
        });

        this.setLoadingState(true, '🤫 Traduction en cours...');

        this.translateBtn.disabled = true;
        const originalIcon = this.translateBtn.innerHTML;
        this.translateBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>';

        try {
            const res = await fetch(`${API_URL}/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    source: this.sourceLang.value,
                    target: this.targetLang.value,
                    userId: USER_ID
                })
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new APIError(
                    errorData.error || `Erreur serveur (${res.status})`,
                    res.status,
                    this.getErrorSolution(res.status, errorData.error)
                );
            }

            const data = await res.json();
            if (data.success) {
                this.outputText.value = data.translation;
                this.checkContextualTranslation(text, data.translation);
                this.toast('Traduction reussie', 'success');
                this.showUndoToast('Traduction éffectuée');
                this.loadHistory();
                this.loadFavorites();
                this.loadStats();
            } else {
                this.toast(data.error, 'error');
            }
        } catch (err) {
            this.handleError(err);
        } finally {
            this.setLoadingState(false);
            this.translateBtn.disabled = false;
            this.translateBtn.innerHTML = originalIcon;
        }
    }

    setLoadingState(isLoading, message = '') {
        let overlay = document.getElementById('loading-overlay');

        if (isLoading) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'loading-overlay';
                overlay.className = 'loading-overlay';
                overlay.innerHTML = `
                    <div class="loading-spinner"></div>
                    <p class="loading-text">${message}</p>
                `;
                document.body.appendChild(overlay);
            }
            overlay.classList.add('active');
            this.inputText.disabled = true;
            this.outputText.disabled = true;
        } else {
            overlay?.classList.remove('active');
            this.inputText.disabled = false;
            this.outputText.disabled = false;
        }
    }

    checkContextualTranslation(original, translated) {
        const lowerOriginal = original.toLowerCase().trim();
        if (this.contextGlossary[lowerOriginal]) {
            const expected = this.contextGlossary[lowerOriginal].en;
            if (translated.toLowerCase() !== expected.toLowerCase()) {
                this.showContextualSuggestion(lowerOriginal, expected);
            }
        }
    }

    saveStateForUndo(state) {
        this.undoStack.push({ ...state, timestamp: Date.now() });
        if (this.undoStack.length > this.maxUndoSize) {
            this.undoStack.shift();
        }
    }

    undo() {
        if (this.undoStack.length === 0) {
            this.toast('Rien a annuler', 'info');
            return;
        }

        const state = this.undoStack.pop();
        this.inputText.value = state.input;
        this.outputText.value = state.output;
        this.sourceLang.value = state.source;
        this.targetLang.value = state.target;
        this.inputText.dispatchEvent(new Event('input'));
        this.toast('Action annulee', 'success');
    }

    showUndoToast(message) {
        const existing = document.querySelector('.undo-toast');
        if (existing) existing.remove();

        const undoToast = document.createElement('div');
        undoToast.className = 'undo-toast';
        undoToast.innerHTML = `
            <span>${message}</span>
            <button class="undo-btn" onclick="app.undo(); this.parentElement.remove()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 7v6h6"/>
                    <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/>
                </svg>
                Annuler
            </button>
        `;
        document.body.appendChild(undoToast);
        setTimeout(() => undoToast.classList.add('show'), 100);
        setTimeout(() => {
            undoToast.classList.remove('show');
            setTimeout(() => undoToast.remove(), 300);
        }, 5000);
    }

    swap() {
        const s = this.sourceLang.value;
        const t = this.targetLang.value;
        this.sourceLang.value = t;
        this.targetLang.value = s;

        const tmp = this.inputText.value;
        this.inputText.value = this.outputText.value;
        this.outputText.value = tmp;

        this.toast('Langues inversées', 'success');
    }

    clear() {
        if (this.inputText.value.trim() || this.outputText.value.trim()) {
            if (!confirm('Voulez-vous vraiment effacer le texte ?')) {
                return;
            }
        }

        this.inputText.value = '';
        this.outputText.value = '';
        this.charCount.textContent = '0 / 5000';
        this.charCount.classList.remove('warning', 'danger');
        this.hideSuggestions();
        this.toast('Texte éffacé', 'info');
    }

    copy() {
        if (!this.outputText.value) {
            this.toast('Rien a copier', 'warning');
            return;
        }
        navigator.clipboard.writeText(this.outputText.value).then(() => {
            this.toast('Copié dans le presse-papiers', 'success');
        }).catch(() => {
            this.toast('Impossible de copier', 'error');
        });
    }

    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `${tab}-tab`));

        if (tab === 'history') this.loadHistory();
        if (tab === 'favorites') this.loadFavorites();
        if (tab === 'stats') this.loadStats();
    }

    async loadHistory() {
        try {
            const res = await fetch(`${API_URL}/translate/history?userId=${USER_ID}`);
            const data = await res.json();
            const list = document.getElementById('history-list');
            const empty = document.getElementById('history-empty');

            if (!data.history?.length) {
                list.innerHTML = '';
                empty.style.display = 'flex';
                this.historyCache = [];
                return;
            }

            this.historyCache = data.history;
            empty.style.display = 'none';
            list.innerHTML = data.history.map(t => `
                <div class="list-item" onclick="app.loadFromHistory('${this.escape(t.original)}', '${this.escape(t.translated)}', '${t.source}', '${t.target}')">
                    <div class="list-item-content">
                        <div class="list-item-original">${this.escape(t.original)}</div>
                        <div class="list-item-translated">${this.escape(t.translated)}</div>
                    </div>
                    <div class="list-item-meta">
                        <span class="lang-tag">${t.source}→${t.target}</span>
                        <span class="time-tag">${new Date(t.timestamp).toLocaleTimeString()}</span>
                    </div>
                </div>
            `).join('');
        } catch (e) { 
            console.error('Erreur loadHistory:', e); 
        }
    }

    loadFromHistory(original, translated, source, target) {
        this.inputText.value = original;
        this.outputText.value = translated;
        this.sourceLang.value = source;
        this.targetLang.value = target;
        this.inputText.dispatchEvent(new Event('input'));
        this.toast('Traduction chargee', 'success');
        this.showRestoreIndicator();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async loadFavorites() {
        try {
            const res = await fetch(`${API_URL}/translate/favorites?userId=${USER_ID}`);
            const data = await res.json();
            const list = document.getElementById('favorites-list');
            const empty = document.getElementById('favorites-empty');

            document.getElementById('stat-favs').textContent = data.favorites?.length || 0;

            if (!data.favorites?.length) {
                list.innerHTML = '';
                empty.style.display = 'flex';
                return;
            }

            empty.style.display = 'none';
            list.innerHTML = data.favorites.map((f, i) => `
                <div class="list-item" onclick="app.inputText.value = '${this.escape(f.text)}'; app.inputText.dispatchEvent(new Event('input')); window.scrollTo({top:0,behavior:'smooth'})">
                    <div class="list-item-content">
                        <div class="list-item-original">${this.escape(f.text)}</div>
                    </div>
                    <div class="list-item-meta">
                        <span class="freq-badge">#${i + 1}</span>
                        <span class="freq-badge">${f.count}×</span>
                    </div>
                </div>
            `).join('');
        } catch (e) { 
            console.error('Erreur loadFavorites:', e); 
        }
    }

    async loadStats() {
        try {
            const res = await fetch(`${API_URL}/translate/stats?userId=${USER_ID}`);
            const data = await res.json();
            const s = data.stats || {};

            document.getElementById('stat-total').textContent = s.totalTranslations || 0;
            document.getElementById('stat-langs').textContent = Object.keys(s.languagesUsed || {}).length;
            document.getElementById('st-total').textContent = s.totalTranslations || 0;
            document.getElementById('st-langs').textContent = Object.keys(s.languagesUsed || {}).length;

            const top = s.topFrequent || [];
            const max = top[0]?.count || 1;
            document.getElementById('st-top').innerHTML = top.slice(0, 5).map(t => `
                <div class="top-item">
                    <span class="top-text" title="${this.escape(t.text)}">${this.escape(t.text)}</span>
                    <div class="top-bar"><div class="top-bar-fill" style="width:${(t.count / max) * 100}%"></div></div>
                    <span class="top-count">${t.count}</span>
                </div>
            `).join('') || '<p class="empty-msg">Aucune donnee</p>';
        } catch (e) { 
            console.error('Erreur loadStats:', e); 
        }
    }

    handleError(error) {
        console.error('Erreur:', error);

        let errorInfo = ERROR_MESSAGES[error.status] || ERROR_MESSAGES[error.message];

        if (!errorInfo) {
            errorInfo = {
                title: 'Une erreur est survenue',
                solution: error.solution || "Veuillez reessayer. Si le probleme persiste, redemarrez l'application.",
                action: 'Reessayer'
            };
        }

        this.showErrorModal(errorInfo);
    }

    showErrorModal(errorInfo) {
        const existing = document.getElementById('error-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'error-modal';
        modal.className = 'error-modal';
        modal.innerHTML = `
            <div class="error-content">
                <h3>${errorInfo.title}</h3>
                <div class="error-solution">
                    <p class="solution-label">Solution :</p>
                    <p class="solution-text">${errorInfo.solution.replace(/\n/g, '<br>')}</p>
                </div>
                <div class="error-actions">
                    ${errorInfo.action ? `<button class="btn btn-primary" onclick="location.reload()">${errorInfo.action}</button>` : ''}
                    <button class="btn" onclick="this.closest('.error-modal').remove()">Fermer</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    getErrorSolution(status, message) {
        if (message?.includes('LibreTranslate')) {
            return "Verifiez que le conteneur Docker LibreTranslate est demarre :docker ps | grep libretranslate";
        }
        return null;
    }

    async checkHealth() {
        try {
            const res = await fetch(`${API_URL}/health`, { timeout: 5000 });
            if (!res.ok) throw new Error('Health check failed');

            const data = await res.json();
            if (!data.https) {
                this.toast('Connexion non securisee detectee', 'warning');
            }
        } catch (e) {
            this.showErrorModal({
                title: 'Serveur inaccessible',
                solution: "Le serveur backend ne repond pas. Assurez-vous qu'il est demarre et accessible.",
                action: 'Rafraichir la page'
            });
        }
    }

    // ========== ONBOARDING ==========
    showOnboarding(force = false) {
        if (!force && this.hasSeenOnboarding) return;

        const steps = [
            {
                element: '#input-text',
                title: 'Bienvenue sur SayTo !',
                text: '🙄 Entrez votre texte ici pour le traduire. Vous pouvez aussi utiliser le micro pour la dictée vocale.',
                position: 'bottom'
            },
            {
                element: '#voice-btn',
                title: 'Dictée vocale',
                text: '😉 Cliquez ici ou appuyez sur la touche <b>V</b> de votre PC pour parler. Le texte sera automatiquement transcrit.',
                position: 'bottom'
            },
            {
                element: '#translate-btn',
                title: 'Traduire',
                text: '😏 Cliquez sur ce bouton ou appuyez sur <b>Ctrl+Enter</b> de votre PC pour traduire votre texte instantanement.',
                position: 'left'
            },
            {
                element: '.tabs',
                title: 'Historique & Favoris',
                text: '😅 Retrouvez ici toutes vos traductions passées et vos mots les plus utilisés. SayTo verifie automatiquement si vous avez déja traduit un texte !',
                position: 'top'
            },
            {
                element: '#swap-btn',
                title: 'Inverser les langues',
                text: '🥱 Echangez rapidement la langue source et cible en cliquant sur ce bouton.',
                position: 'bottom'
            }
        ];

        this.runTour(steps, force);

        if (!force) {
            localStorage.setItem('sayto_onboarding', 'true');
            this.hasSeenOnboarding = true;
        }
    }

    runTour(steps, forceRestart = false) {
        let currentStep = 0;
        const container = this.onboardingContainer;

        container.innerHTML = '';

        const showStep = (index) => {
            if (index >= steps.length) {
                container.innerHTML = '';
                return;
            }

            const step = steps[index];
            const target = document.querySelector(step.element);

            if (!target) {
                showStep(index + 1);
                return;
            }

            requestAnimationFrame(() => {
                const rect = target.getBoundingClientRect();

                const backdrop = document.createElement('div');
                backdrop.className = 'onboarding-backdrop';

                const highlight = document.createElement('div');
                highlight.className = 'onboarding-highlight';

                const padding = 0;
                const targetStyles = window.getComputedStyle(target);
                const targetRadius = targetStyles.borderRadius;

                highlight.style.cssText = `
                    top: ${rect.top - padding}px;
                    left: ${rect.left - padding}px;
                    width: ${rect.width + padding * 2}px;
                    height: ${rect.height + padding * 2}px;
                    border-radius: ${targetRadius};
                `;

                const tooltip = document.createElement('div');
                tooltip.className = 'onboarding-tooltip';

                const tooltipWidth = 360;
                const spacing = 20;
                let tooltipTop, tooltipLeft;

                switch (step.position || 'bottom') {
                    case 'top':
                        tooltipTop = rect.top - spacing - 250;
                        tooltipLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
                        break;
                    case 'bottom':
                        tooltipTop = rect.bottom + spacing + padding;
                        tooltipLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
                        break;
                    case 'left':
                        tooltipTop = rect.top + rect.height / 2 - 120;
                        tooltipLeft = rect.left - tooltipWidth - spacing - padding;
                        break;
                    case 'right':
                        tooltipTop = rect.top + rect.height / 2 - 120;
                        tooltipLeft = rect.right + spacing + padding;
                        break;
                    default:
                        tooltipTop = rect.bottom + spacing + padding;
                        tooltipLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
                }

                tooltipLeft = Math.max(20, Math.min(tooltipLeft, window.innerWidth - tooltipWidth - 20));
                tooltipTop = Math.max(20, Math.min(tooltipTop, window.innerHeight - 280));

                tooltip.style.cssText = `
                    top: ${tooltipTop}px;
                    left: ${tooltipLeft}px;
                    width: ${tooltipWidth}px;
                `;

                const progressDots = steps.map((_, i) => 
                    `<div class="onboarding-progress-dot ${i === index ? 'active' : ''}"></div>`
                ).join('');

                const isLast = index === steps.length - 1;
                const isFirst = index === 0;

                tooltip.innerHTML = `
                    <h4>${step.title}</h4>
                    <p>${step.text}</p>
                    <div class="onboarding-progress">${progressDots}</div>
                    <div class="onboarding-nav">
                        <div class="onboarding-nav-left">
                            ${!isFirst ? `<button class="onboarding-btn onboarding-btn-secondary" id="onboarding-prev">Précédent</button>` : ''}
                        </div>
                        <button class="onboarding-skip" id="onboarding-skip">Passer</button>
                        <button class="onboarding-btn onboarding-btn-primary" id="onboarding-next">
                            ${isLast ? 'Terminer' : 'Suivant'}
                        </button>
                    </div>
                `;

                container.appendChild(backdrop);
                container.appendChild(highlight);
                container.appendChild(tooltip);

                document.getElementById('onboarding-next').addEventListener('click', () => {
                    container.innerHTML = '';
                    showStep(index + 1);
                });

                if (!isFirst) {
                    document.getElementById('onboarding-prev').addEventListener('click', () => {
                        container.innerHTML = '';
                        showStep(index - 1);
                    });
                }

                document.getElementById('onboarding-skip').addEventListener('click', () => {
                    container.innerHTML = '';
                    localStorage.setItem('sayto_onboarding', 'true');
                });

                backdrop.addEventListener('click', () => {
                    container.innerHTML = '';
                    localStorage.setItem('sayto_onboarding', 'true');
                });
            });
        };

        setTimeout(() => showStep(0), 300);
    }

    // ========== UTILS ==========
    toast(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = msg;
        this.toastContainer.appendChild(toast);

        toast.offsetHeight;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    escape(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }
}

class APIError extends Error {
    constructor(message, status, solution) {
        super(message);
        this.status = status;
        this.solution = solution;
    }
}

const app = new TranslateApp();