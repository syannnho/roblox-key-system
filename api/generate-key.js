import crypto from 'crypto';

// Fungsi untuk generate random key
function generateKey() {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
}

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
async function updateGitHubFile(owner, repo, path, content, message, token, sha = null) {
    const body = {
        message: message,
        content: Buffer.from(content).toString('base64'),
    };
    
    if (sha) {
        body.sha = sha;
    }
    
    const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
        {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        }
    );
    
    return await response.json();
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { username, duration } = req.body;
        
        if (!username || !duration) {
            return res.status(400).json({ error: 'Username dan duration wajib diisi' });
        }
        
        // Validate username format
        if (!/^[A-Za-z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Username tidak valid' });
        }
        
        // Environment variables dari Vercel
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const GITHUB_OWNER = process.env.GITHUB_OWNER;
        const GITHUB_REPO = process.env.GITHUB_REPO;
        
        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            return res.status(500).json({ 
                error: 'GitHub credentials tidak dikonfigurasi' 
            });
        }
        
        // Generate key
        const key = generateKey();
        
        // Calculate expiry
        let expiresAt;
        if (duration === 'permanent') {
            expiresAt = null;
        } else {
            const days = parseInt(duration);
            expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        }
        
        // Get existing keys file
        const filePath = 'keys.json';
        const existingFile = await getGitHubFile(GITHUB_OWNER, GITHUB_REPO, filePath, GITHUB_TOKEN);
        
        let keys = [];
        let sha = null;
        
        if (existingFile && existingFile.content) {
            sha = existingFile.sha;
            const content = Buffer.from(existingFile.content, 'base64').toString('utf-8');
            keys = JSON.parse(content);
        }
        
        // Add new key
        keys.push({
            key: key,
            username: username,
            duration: duration,
            createdAt: new Date().toISOString(),
            expiresAt: expiresAt
        });
        
        // Update GitHub file
        const newContent = JSON.stringify(keys, null, 2);
        await updateGitHubFile(
            GITHUB_OWNER,
            GITHUB_REPO,
            filePath,
            newContent,
            `Add key for ${username}`,
            GITHUB_TOKEN,
            sha
        );
        
        return res.status(200).json({
            success: true,
            message: 'Key berhasil dibuat dan disimpan!',
            key: key,
            username: username,
            duration: duration,
            expiresAt: expiresAt
        });
        
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Terjadi kesalahan server: ' + error.message 
        });
    }
}
