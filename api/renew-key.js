import crypto from 'crypto';

// ==================== HELPER FUNCTIONS ====================
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
    
    if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
    }
    
    return await response.json();
}

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
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update GitHub file: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
}

// ==================== MAIN HANDLER ====================
export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false,
            error: 'Method not allowed' 
        });
    }
    
    try {
        const { username, duration } = req.body;
        
        // Validate input
        if (!username || !duration) {
            return res.status(400).json({ 
                success: false,
                error: 'Username dan duration wajib diisi' 
            });
        }
        
        const validDurations = ['1', '24', '72', '168', '720'];
        if (!validDurations.includes(duration.toString())) {
            return res.status(400).json({ 
                success: false,
                error: 'Duration tidak valid' 
            });
        }
        
        // Get GitHub credentials
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const GITHUB_OWNER = process.env.GITHUB_OWNER;
        const GITHUB_REPO = process.env.GITHUB_REPO;
        
        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            console.error('Missing environment variables');
            return res.status(500).json({ 
                success: false,
                error: 'Server configuration error' 
            });
        }
        
        console.log(`[RENEW] Processing request for: ${username}`);
        
        // Get keys file
        const filePath = 'keys.json';
        const file = await getGitHubFile(GITHUB_OWNER, GITHUB_REPO, filePath, GITHUB_TOKEN);
        
        if (!file || !file.content) {
            return res.status(404).json({ 
                success: false,
                error: 'Keys database tidak ditemukan' 
            });
        }
        
        const content = Buffer.from(file.content, 'base64').toString('utf-8');
        let keys = JSON.parse(content);
        
        console.log(`[RENEW] Found ${keys.length} keys in database`);
        
        // Find user's active key
        const now = new Date();
        const keyIndex = keys.findIndex(k => {
            if (k.username !== username) return false;
            
            // Check if key is still active
            if (!k.expiresAt) return true; // Permanent key
            
            const keyExpiry = new Date(k.expiresAt);
            return keyExpiry > now; // Not expired
        });
        
        if (keyIndex === -1) {
            return res.status(404).json({ 
                success: false,
                error: 'Tidak ada key aktif ditemukan untuk username ini' 
            });
        }
        
        const keyData = keys[keyIndex];
        console.log(`[RENEW] Found active key for: ${username}`);
        
        // Check if permanent
        if (!keyData.expiresAt || keyData.duration === 'permanent') {
            return res.status(400).json({ 
                success: false,
                error: 'Key permanent tidak perlu di-renew' 
            });
        }
        
        // Check if expired
        const expiryDate = new Date(keyData.expiresAt);
        if (expiryDate < now) {
            return res.status(400).json({ 
                success: false,
                error: 'Key sudah expired, tidak bisa di-renew' 
            });
        }
        
        // Check if time remaining > 1 hour
        const timeRemaining = expiryDate - now;
        const hoursRemaining = timeRemaining / (1000 * 60 * 60);
        
        if (hoursRemaining < 1) {
            return res.status(400).json({ 
                success: false,
                error: `Key hanya bisa di-renew jika sisa waktu > 1 jam. Sisa waktu: ${Math.round(hoursRemaining * 60)} menit` 
            });
        }
        
        console.log(`[RENEW] Current expiry: ${expiryDate.toISOString()}`);
        console.log(`[RENEW] Hours remaining: ${hoursRemaining.toFixed(2)}`);
        
        // Renew: Add duration to current expiry
        const durationHours = parseInt(duration);
        const newExpiryDate = new Date(expiryDate.getTime() + (durationHours * 60 * 60 * 1000));
        
        console.log(`[RENEW] Adding ${durationHours} hours`);
        console.log(`[RENEW] New expiry: ${newExpiryDate.toISOString()}`);
        
        // Update key data
        keys[keyIndex].expiresAt = newExpiryDate.toISOString();
        keys[keyIndex].lastRenewedAt = now.toISOString();
        keys[keyIndex].renewCount = (keyData.renewCount || 0) + 1;
        
        // Save to GitHub
        const newContent = JSON.stringify(keys, null, 2);
        await updateGitHubFile(
            GITHUB_OWNER,
            GITHUB_REPO,
            filePath,
            newContent,
            `Renew key for ${username} (+${durationHours}h)`,
            GITHUB_TOKEN,
            file.sha
        );
        
        console.log(`[RENEW] ✅ Successfully renewed key for: ${username}`);
        
        return res.status(200).json({
            success: true,
            message: `✅ Key berhasil di-renew +${durationHours} jam! Expired: ${newExpiryDate.toLocaleString('id-ID')}`,
            newExpiresAt: newExpiryDate.toISOString(),
            renewCount: keys[keyIndex].renewCount,
            username: username
        });
        
    } catch (error) {
        console.error('[RENEW] ❌ Error:', error);
        return res.status(500).json({ 
            success: false,
            error: 'Terjadi kesalahan server: ' + error.message 
        });
    }
}
