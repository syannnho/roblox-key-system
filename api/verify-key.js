// Fungsi untuk get file dari GitHub
async function getGitHubFile(owner, repo, path, token) {
    const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
        {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        }
    );
    
    if (response.status === 404) {
        return null;
    }
    
    return await response.json();
}

// Fungsi untuk update file di GitHub
async function updateGitHubFile(owner, repo, path, content, message, token, sha) {
    const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
        {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                content: Buffer.from(content).toString('base64'),
                sha: sha
            })
        }
    );
    
    return await response.json();
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { key, username } = req.method === 'POST' ? req.body : req.query;
        
        if (!key || !username) {
            return res.status(400).json({ 
                valid: false,
                error: 'Key dan username wajib diisi' 
            });
        }
        
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const GITHUB_OWNER = process.env.GITHUB_OWNER;
        const GITHUB_REPO = process.env.GITHUB_REPO;
        
        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            return res.status(500).json({ 
                valid: false,
                error: 'GitHub credentials tidak dikonfigurasi' 
            });
        }
        
        // Get keys file
        const filePath = 'keys.json';
        const file = await getGitHubFile(GITHUB_OWNER, GITHUB_REPO, filePath, GITHUB_TOKEN);
        
        if (!file || !file.content) {
            return res.status(200).json({ 
                valid: false,
                error: 'Tidak ada key yang terdaftar' 
            });
        }
        
        const content = Buffer.from(file.content, 'base64').toString('utf-8');
        let keys = JSON.parse(content);
        
        // ===== AUTO CLEANUP EXPIRED KEYS =====
        const now = new Date();
        const initialCount = keys.length;
        
        const activeKeys = keys.filter(keyData => {
            if (!keyData.expiresAt) return true; // Permanent keys
            return new Date(keyData.expiresAt) > now;
        });
        
        // Update file jika ada key yang expired
        if (activeKeys.length < initialCount) {
            const deletedCount = initialCount - activeKeys.length;
            await updateGitHubFile(
                GITHUB_OWNER,
                GITHUB_REPO,
                filePath,
                JSON.stringify(activeKeys, null, 2),
                `Auto cleanup: Removed ${deletedCount} expired key(s)`,
                GITHUB_TOKEN,
                file.sha
            );
            keys = activeKeys; // Update keys untuk verifikasi
        }
        // ===== END AUTO CLEANUP =====
        
        // Find key
        const keyData = keys.find(k => k.key === key && k.username === username);
        
        if (!keyData) {
            return res.status(200).json({ 
                valid: false,
                error: 'Key tidak valid atau username tidak sesuai' 
            });
        }
        
        // Check expiry (double check meskipun sudah di-cleanup)
        if (keyData.expiresAt) {
            const expiryDate = new Date(keyData.expiresAt);
            if (expiryDate < now) {
                return res.status(200).json({ 
                    valid: false,
                    error: 'Key sudah expired' 
                });
            }
        }
        
        return res.status(200).json({
            valid: true,
            message: 'Key valid!',
            data: {
                username: keyData.username,
                duration: keyData.duration,
                createdAt: keyData.createdAt,
                expiresAt: keyData.expiresAt
            }
        });
        
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            valid: false,
            error: 'Terjadi kesalahan server: ' + error.message 
        });
    }
}
