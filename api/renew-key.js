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
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { key, username } = req.body;
        
        if (!key || !username) {
            return res.status(400).json({ error: 'Key dan username wajib diisi' });
        }
        
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const GITHUB_OWNER = process.env.GITHUB_OWNER;
        const GITHUB_REPO = process.env.GITHUB_REPO;
        
        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            return res.status(500).json({ 
                error: 'GitHub credentials tidak dikonfigurasi' 
            });
        }
        
        // Get keys file
        const filePath = 'keys.json';
        const file = await getGitHubFile(GITHUB_OWNER, GITHUB_REPO, filePath, GITHUB_TOKEN);
        
        if (!file || !file.content) {
            return res.status(404).json({ 
                error: 'File keys tidak ditemukan' 
            });
        }
        
        const content = Buffer.from(file.content, 'base64').toString('utf-8');
        let keys = JSON.parse(content);
        
        // Find key
        const keyIndex = keys.findIndex(k => k.key === key && k.username === username);
        
        if (keyIndex === -1) {
            return res.status(404).json({ 
                error: 'Key tidak ditemukan' 
            });
        }
        
        const keyData = keys[keyIndex];
        
        // Check if permanent
        if (!keyData.expiresAt || keyData.duration === 'permanent') {
            return res.status(400).json({ 
                error: 'Key permanent tidak perlu di-renew' 
            });
        }
        
        // Check if expired
        const now = new Date();
        const expiryDate = new Date(keyData.expiresAt);
        
        if (expiryDate < now) {
            return res.status(400).json({ 
                error: 'Key sudah expired, tidak bisa di-renew' 
            });
        }
        
        // Check if time remaining > 1 hour
        const timeRemaining = expiryDate - now;
        const hoursRemaining = timeRemaining / (1000 * 60 * 60);
        
        if (hoursRemaining < 1) {
            return res.status(400).json({ 
                error: `Key hanya bisa di-renew jika sisa waktu > 1 jam. Sisa waktu: ${Math.round(hoursRemaining * 60)} menit` 
            });
        }
        
        // Renew: Add original duration to current expiry
        const durationHours = parseInt(keyData.duration);
        const newExpiryDate = new Date(expiryDate.getTime() + (durationHours * 60 * 60 * 1000));
        
        // Update key data
        keys[keyIndex].expiresAt = newExpiryDate.toISOString();
        keys[keyIndex].renewedAt = now.toISOString();
        keys[keyIndex].renewCount = (keyData.renewCount || 0) + 1;
        
        // Save to GitHub
        const newContent = JSON.stringify(keys, null, 2);
        await updateGitHubFile(
            GITHUB_OWNER,
            GITHUB_REPO,
            filePath,
            newContent,
            `Renew key for ${username}`,
            GITHUB_TOKEN,
            file.sha
        );
        
        return res.status(200).json({
            success: true,
            message: `Key berhasil di-renew! Expired: ${newExpiryDate.toLocaleString('id-ID')}`,
            newExpiresAt: newExpiryDate.toISOString(),
            renewCount: keys[keyIndex].renewCount
        });
        
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Terjadi kesalahan server: ' + error.message 
        });
    }
}
