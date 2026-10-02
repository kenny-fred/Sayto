// Modules
const axios = require('axios');
const os = require('os');

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

const LIBRE_URL = 'http://localhost:5000';

class LibreTranslateService {
    async translate(text, source, target) {
        const response = await axios.post(`${LIBRE_URL}/translate`, {
            q: text,
            source: source,
            target: target,
            format: 'text'
        }, {
            timeout: 10000 // 10 secondes
        });
        return response.data;
    }

    async getLanguages() {
        const response = await axios.get(`${LIBRE_URL}/languages`, {
            timeout: 5000
        });
        return response.data;
    }
}

module.exports = new LibreTranslateService();