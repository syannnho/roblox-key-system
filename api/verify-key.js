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
        const keys = JSON.parse(content);
        
        // Find key
        const keyData = keys.find(k => k.key === key && k.username === username);
        
        if (!keyData) {
            return res.status(200).json({ 
                valid: false,
                error: 'Key tidak valid atau username tidak sesuai' 
            });
        }
        
        // Check expiry
        if (keyData.expiresAt) {
            const expiryDate = new Date(keyData.expiresAt);
            if (expiryDate < new Date()) {
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
