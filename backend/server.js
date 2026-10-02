// Modules
const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

// Routes et Base de données
const translateRoutes = require('./routes/translate');
const db = require('./database/db');

const app = express();
const PORT = 443;

// Certificat HTTPS
const certsPath = path.join(__dirname, 'certs');
const keyPath = path.join(certsPath, 'key.pem');
const certPath = path.join(certsPath, 'cert.pem');

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error('❌ Certificats HTTPS introuvables !');
    console.error('   Attendus dans:', certsPath);
    process.exit(1);
}

const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
};

console.log('Certificats HTTPS chargés');

// IP RÉSEAU
function getNetworkIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal && 
                !name.includes('vEthernet') && !name.includes('VMware') && !name.includes('Virtual')) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const NETWORK_IP = getNetworkIP();

// Middleware
app.use(cors());
app.use(express.json());



// Chemins des fichiers de données
const DATA_DIR = path.join(__dirname, 'database');
const REVIEWS_FILE = path.join(DATA_DIR, 'sayto.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');

// S'assurer que le dossier database existe
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialiser les fichiers JSON UNIQUEMENT s'ils n'existent pas
function initJsonFile(filePath, defaultData) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
        console.log(`📁 Créé: ${path.basename(filePath)}`);
    }
}

initJsonFile(REVIEWS_FILE, { reviews: [] });
initJsonFile(ADMIN_FILE, { 
    adminUserId: null,
    adminPasswordHash: null,
    isFirstUser: true 
});
initJsonFile(NOTIFICATIONS_FILE, { 
    notifications: [],
    adminReplies: [] 
});

// DB
db.init().then(() => console.log('DB JSON initialisée'));

// ============ HELPERS ============

function readReviews() {
    try {
        const data = fs.readFileSync(REVIEWS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { reviews: [] };
    }
}

function writeReviews(data) {
    fs.writeFileSync(REVIEWS_FILE, JSON.stringify(data, null, 2));
}

function readAdmin() {
    try {
        const data = fs.readFileSync(ADMIN_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { adminUserId: null, adminPasswordHash: null, isFirstUser: true };
    }
}

function writeAdmin(data) {
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(data, null, 2));
}

function readNotifications() {
    try {
        const data = fs.readFileSync(NOTIFICATIONS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { notifications: [], adminReplies: [] };
    }
}

function writeNotifications(data) {
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(data, null, 2));
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Middleware d'authentification admin
function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    const adminData = readAdmin();
    
    if (!token || token !== adminData.currentToken) {
        return res.status(403).json({ success: false, error: 'Accès admin requis' });
    }
    next();
}

// ============ ROUTES API REVIEWS ============

// GET /api/reviews - Récupérer tous les avis
app.get('/api/reviews', (req, res) => {
    const data = readReviews();
    data.reviews.sort((a, b) => b.score - a.score);
    res.json({ success: true, reviews: data.reviews });
});

// POST /api/reviews - Soumettre un nouvel avis
app.post('/api/reviews', (req, res) => {
    const { userId, score, comment, suggestion } = req.body;

    if (!userId || typeof score !== 'number' || !comment || comment.trim() === '') {
        return res.status(400).json({
            success: false,
            error: 'Données invalides. userId, score et comment sont obligatoires.'
        });
    }

    if (score < 0 || score > 20) {
        return res.status(400).json({
            success: false,
            error: 'Le score doit être entre 0 et 20.'
        });
    }

    const data = readReviews();
    const existingIndex = data.reviews.findIndex(r => r.userId === userId);
    const newReview = {
        userId,
        score,
        comment: comment.trim(),
        suggestion: suggestion ? suggestion.trim() : null,
        date: new Date().toISOString(),
        adminReply: null,
        replyDate: null,
        isRead: false
    };

    if (existingIndex >= 0) {
        data.reviews[existingIndex] = newReview;
    } else {
        data.reviews.push(newReview);
    }

    writeReviews(data);

    // Créer une notification pour l'admin
    const notifData = readNotifications();
    notifData.notifications.push({
        id: crypto.randomUUID(),
        type: 'new_review',
        userId: userId,
        message: `Nouvel avis de ${userId.substring(0, 8)}...`,
        date: new Date().toISOString(),
        isRead: false,
        reviewId: newReview.date
    });
    writeNotifications(notifData);

    res.json({ success: true, review: newReview });
});

// GET /api/reviews/:userId - Avis d'un utilisateur
app.get('/api/reviews/:userId', (req, res) => {
    const data = readReviews();
    const review = data.reviews.find(r => r.userId === req.params.userId);
    if (review) {
        res.json({ success: true, review });
    } else {
        res.json({ success: false, message: 'Aucun avis trouvé' });
    }
});

// GET /api/reviews/stats - Statistiques des avis
app.get('/api/reviews/stats', (req, res) => {
    const data = readReviews();
    if (data.reviews.length === 0) {
        return res.json({ success: true, stats: { average: 0, count: 0, distribution: {} } });
    }

    const totalScore = data.reviews.reduce((sum, r) => sum + r.score, 0);
    const average = (totalScore / data.reviews.length).toFixed(1);

    const distribution = { '0-5': 0, '6-10': 0, '11-15': 0, '16-20': 0 };
    data.reviews.forEach(r => {
        if (r.score <= 5) distribution['0-5']++;
        else if (r.score <= 10) distribution['6-10']++;
        else if (r.score <= 15) distribution['11-15']++;
        else distribution['16-20']++;
    });

    res.json({
        success: true,
        stats: {
            average: parseFloat(average),
            count: data.reviews.length,
            distribution
        }
    });
});

// ============ ROUTES ADMIN ============

// Vérifier si premier utilisateur (pas encore d'admin)
app.get('/api/admin/check-first-user', (req, res) => {
    const adminData = readAdmin();
    res.json({ 
        success: true, 
        isFirstUser: !adminData.adminUserId,
        hasPassword: !!adminData.adminPasswordHash
    });
});

// Enregistrer le premier admin
app.post('/api/admin/register', (req, res) => {
    const { userId, password } = req.body;
    const adminData = readAdmin();

    if (adminData.adminUserId) {
        return res.status(400).json({ success: false, error: 'Un admin existe déjà' });
    }

    if (!userId || !password || password.length < 6) {
        return res.status(400).json({ success: false, error: 'userId et mot de passe (min 6 caractères) requis' });
    }

    const token = generateToken();
    const newAdmin = {
        adminUserId: userId,
        adminPasswordHash: hashPassword(password),
        currentToken: token,
        createdAt: new Date().toISOString()
    };

    writeAdmin(newAdmin);
    res.json({ success: true, token, message: 'Admin créé avec succès' });
});

// Connexion admin
app.post('/api/admin/login', (req, res) => {
    const { userId, password } = req.body;
    const adminData = readAdmin();

    if (!adminData.adminUserId) {
        return res.status(400).json({ success: false, error: 'Aucun admin configuré' });
    }

    if (adminData.adminUserId !== userId) {
        return res.status(403).json({ success: false, error: 'Votre compte n\'est pas autorisé' });
    }

    if (adminData.adminPasswordHash !== hashPassword(password)) {
        return res.status(403).json({ success: false, error: 'Mot de passe incorrect' });
    }

    const token = generateToken();
    adminData.currentToken = token;
    adminData.lastLogin = new Date().toISOString();
    writeAdmin(adminData);

    res.json({ success: true, token });
});

// Vérifier token admin
app.get('/api/admin/verify', requireAdmin, (req, res) => {
    const adminData = readAdmin(); // ← AJOUTÉ
    res.json({ success: true, isAdmin: true, userId: adminData.adminUserId });
});

// Vérifier si l'utilisateur connecté est l'admin (pour le hack 404 côté client)
app.get('/api/admin/check', (req, res) => {
    const adminData = readAdmin();
    const userId = req.headers['x-user-id'] || req.query.userId; // ← il faut recevoir le userId du client
    
    // Si pas d'admin configuré
    if (!adminData.adminUserId) {
        return res.json({ 
            success: true, 
            isAdmin: false, 
            userId: null,
            message: 'Aucun admin configuré'
        });
    }
    
    // Vérifier que le userId fourni correspond à l'admin
    const isAdmin = userId === adminData.adminUserId;
    
    res.json({ 
        success: true, 
        isAdmin: isAdmin, 
        userId: adminData.adminUserId,
        message: isAdmin ? 'Vous êtes admin' : 'Accès refusé'
    });
});

// Dashboard stats (admin uniquement) - UNIQUEMENT LANGUE CIBLE (target)
app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
    try {
        const allStats = await db.getAllStats();
        const reviewsData = readReviews();
        const allHistory = await db.getAllHistory();

        // ✅ UNIQUEMENT la langue CIBLE (target)
        let enCount = 0;
        let frCount = 0;
        const wordFrequency = {};

        allHistory.forEach(h => {
            if (h.target === 'en') enCount++;
            else if (h.target === 'fr') frCount++;

            const words = (h.original + ' ' + h.translated).toLowerCase()
                .replace(/[^\w\s]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 2);
            
            words.forEach(w => {
                wordFrequency[w] = (wordFrequency[w] || 0) + 1;
            });
        });

        const topWords = Object.entries(wordFrequency)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([word, count]) => ({ word, count }));

        const notifData = readNotifications();
        const unreadNotifs = notifData.notifications.filter(n => !n.isRead);

        res.json({
            success: true,
            dashboard: {
                totalTranslations: allStats.totalTranslations || 0,
                totalUsers: allStats.totalUsers || 0,
                enCount,
                frCount,
                topWords,
                averageRating: reviewsData.reviews.length ? 
                    (reviewsData.reviews.reduce((s, r) => s + r.score, 0) / reviewsData.reviews.length).toFixed(1) : 0,
                totalReviews: reviewsData.reviews.length,
                unreadNotifications: unreadNotifs.length
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Répondre à un avis (admin)
app.post('/api/admin/reply', requireAdmin, (req, res) => {
    const { userId, reply } = req.body;
    if (!userId || !reply) {
        return res.status(400).json({ success: false, error: 'userId et reply requis' });
    }

    const data = readReviews();
    const reviewIndex = data.reviews.findIndex(r => r.userId === userId);
    
    if (reviewIndex === -1) {
        return res.status(404).json({ success: false, error: 'Avis non trouvé' });
    }

    data.reviews[reviewIndex].adminReply = reply;
    data.reviews[reviewIndex].replyDate = new Date().toISOString();
    data.reviews[reviewIndex].isRead = false;
    writeReviews(data);

    const notifData = readNotifications();
    notifData.adminReplies.push({
        id: crypto.randomUUID(),
        userId: userId,
        reply: reply,
        date: new Date().toISOString(),
        isRead: false
    });
    writeNotifications(notifData);

    const notifIndex = notifData.notifications.findIndex(n => n.userId === userId && n.type === 'new_review');
    if (notifIndex !== -1) {
        notifData.notifications[notifIndex].isRead = true;
        writeNotifications(notifData);
    }

    res.json({ success: true, message: 'Réponse envoyée' });
});

// Récupérer notifications admin
app.get('/api/admin/notifications', requireAdmin, (req, res) => {
    const notifData = readNotifications();
    const unread = notifData.notifications.filter(n => !n.isRead);
    res.json({ success: true, notifications: unread });
});

// Marquer notification comme lue
app.post('/api/admin/notifications/:id/read', requireAdmin, (req, res) => {
    const notifData = readNotifications();
    const notif = notifData.notifications.find(n => n.id === req.params.id);
    if (notif) {
        notif.isRead = true;
        writeNotifications(notifData);
    }
    res.json({ success: true });
});

// ============ ROUTES UTILISATEUR NOTIFICATIONS ============

// Vérifier si l'utilisateur a des réponses admin non lues
app.get('/api/user/notifications/:userId', (req, res) => {
    const notifData = readNotifications();
    const userReplies = notifData.adminReplies.filter(r => 
        r.userId === req.params.userId && !r.isRead
    );
    res.json({ success: true, hasUnread: userReplies.length > 0, replies: userReplies });
});

// Marquer réponse comme lue
app.post('/api/user/notifications/read', (req, res) => {
    const { userId, replyId } = req.body;
    const notifData = readNotifications();
    
    const reply = notifData.adminReplies.find(r => r.id === replyId && r.userId === userId);
    if (reply) {
        reply.isRead = true;
        writeNotifications(notifData);
    }
    
    res.json({ success: true });
});

// ============ ROUTES API TRANSLATE ============

app.use('/api/translate', translateRoutes);

// ============ HOT RELOAD - COMPTEUR DE REQUÊTES ============
let requestCounter = 0;

// Incrémenter le compteur à chaque requête API
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        requestCounter++;
    }
    next();
});

// Modifier /api/health pour inclure le compteur
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        db: 'JSON', 
        timestamp: new Date(),
        serverIP: NETWORK_IP,
        https: true,
        uptime: process.uptime(),
        requestCount: requestCounter // ← AJOUTÉ
    });
});

// ============ FRONTEND ============

app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/about', express.static(path.join(__dirname, '../frontend', 'about.html')));
app.use('/admin', express.static(path.join(__dirname, '../frontend', 'admin.html')));

// 404
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, '../frontend', '404.html'));
});

// Serveur HTTP sur port 80 qui redirige vers HTTPS
http.createServer((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    res.end();
}).listen(80, () => {
    console.log('Redirection HTTP(80) → HTTPS(443) activée');
});


// Lancer le serveur HTTPS
https.createServer(options, app).listen(PORT, '0.0.0.0', () => {
    const isDefaultHttps = PORT === 443;
    const portSuffix = isDefaultHttps ? '' : `:${PORT}`;
    
    console.log(`Local  :  https://localhost${portSuffix}`);
    console.log(`Réseau :  https://${NETWORK_IP}${portSuffix}`);
});