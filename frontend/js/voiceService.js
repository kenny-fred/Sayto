class VoiceService {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.onResult = null;
        this.onError = null;
        this.onStart = null;
        this.onEnd = null;

        this.init();
    }

    init() {
        // Vérifier support navigateur
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            console.warn('Web Speech API non supportée');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false; // Une phrase à la fois
        this.recognition.interimResults = true; // Résultats temporaires
        this.recognition.lang = 'fr-FR'; // Français France
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
            this.isListening = true;
            this.onStart?.();
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.onEnd?.();
        };

        this.recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            this.onResult?.({
                final: finalTranscript,
                interim: interimTranscript,
                isFinal: event.results[event.results.length - 1].isFinal
            });
        };

        this.recognition.onerror = (event) => {
            this.isListening = false;
            const errors = {
                'no-speech': 'Aucune parole détectée',
                'aborted': 'Enregistrement annulé',
                'audio-capture': 'Microphone non accessible',
                'network': 'Erreur réseau',
                'not-allowed': 'Permission micro refusée',
                'service-not-allowed': 'Service non autorisé'
            };
            this.onError?.(errors[event.error] || `Erreur: ${event.error}`);
        };
    }

    start() {
        if (!this.recognition) {
            this.onError?.('Web Speech API non supportée par ce navigateur');
            return false;
        }

        if (this.isListening) {
            this.stop();
            return false;
        }

        try {
            this.recognition.start();
            return true;
        } catch (e) {
            this.onError?.('Erreur démarrage: ' + e.message);
            return false;
        }
    }

    stop() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
    }

    isSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }
}

// Export pour app.js
window.VoiceService = VoiceService;