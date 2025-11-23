import crypto from 'crypto';

// ==================== HELPER FUNCTIONS ====================

// Generate random key
function generateKey() {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
}

// Get file from GitHub
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

// Update file in GitHub
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
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false,
            error: 'Method not allowed. Use POST.' 
        });
    }
    
    try {
        // ===== 1. VALIDATE INPUT =====
        const { username, duration } = req.body;
        
        if (!username || !duration) {
            return res.status(400).json({ 
                success: false,
                error: 'Username dan duration wajib diisi' 
            });
        }
        
        // Validate username format (alphanumeric and underscore only)
        if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
            return res.status(400).json({ 
                success: false,
                error: 'Username tidak valid (3-20 karakter, hanya huruf, angka, dan underscore)' 
            });
        }
        
        // Validate duration
        const validDurations = ['1', '24', '72', '168', '720', 'permanent'];
        if (!validDurations.includes(duration.toString())) {
            return res.status(400).json({ 
                success: false,
                error: 'Duration tidak valid' 
            });
        }
        
        // ===== 2. CHECK ENVIRONMENT VARIABLES =====
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const GITHUB_OWNER = process.env.GITHUB_OWNER;
        const GITHUB_REPO = process.env.GITHUB_REPO;
        
        if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
            console.error('Missing environment variables');
            return res.status(500).json({ 
                success: false,
                error: 'Server configuration error. Please contact administrator.' 
            });
        }
        
        // ===== 3. GENERATE KEY =====
        const key = generateKey();
        console.log(`[GENERATE] Creating key for user: ${username}`);
        
        // ===== 4. CALCULATE EXPIRY DATE =====
        let expiresAt = null;
        let durationText = '';
        
        if (duration === 'permanent') {
            expiresAt = null;
            durationText = 'Permanent';
        } else {
            const hours = parseInt(duration);
            const expiryDate = new Date(Date.now() + hours * 60 * 60 * 1000);
            expiresAt = expiryDate.toISOString();
            
            // Format duration text
            if (hours < 24) {
                durationText = `${hours} Hour${hours > 1 ? 's' : ''}`;
            } else {
                const days = Math.floor(hours / 24);
                durationText = `${days} Day${days > 1 ? 's' : ''}`;
            }
        }
        
        // ===== 5. GET EXISTING KEYS FILE =====
        const filePath = 'keys.json';
        let keys = [];
        let sha = null;
        
        try {
            const existingFile = await getGitHubFile(GITHUB_OWNER, GITHUB_REPO, filePath, GITHUB_TOKEN);
            
            if (existingFile && existingFile.content) {
                sha = existingFile.sha;
                const content = Buffer.from(existingFile.content, 'base64').toString('utf-8');
                keys = JSON.parse(content);
                console.log(`[GENERATE] Found ${keys.length} existing keys`);
            } else {
                console.log('[GENERATE] No existing keys file, creating new');
            }
        } catch (error) {
            console.error('[GENERATE] Error reading keys file:', error.message);
            // Continue with empty keys array
        }
        
        // ===== 6. CHECK FOR EXISTING ACTIVE KEY =====
        const now = new Date();
        const existingKeyIndex = keys.findIndex(k => {
            if (k.username !== username) return false;
            
            // Check if key is still active
            if (!k.expiresAt) return true; // Permanent key
            
            const keyExpiry = new Date(k.expiresAt);
            return keyExpiry > now; // Not expired
        });
        
        if (existingKeyIndex !== -1) {
            const existingKey = keys[existingKeyIndex];
            const expiryDate = existingKey.expiresAt ? new Date(existingKey.expiresAt) : null;
            const expiryText = expiryDate ? expiryDate.toLocaleString('id-ID') : 'Never';
            
            return res.status(400).json({ 
                success: false,
                error: `User ${username} sudah memiliki key aktif yang expired pada: ${expiryText}. Tunggu hingga expired atau gunakan fitur renew.`,
                existingKey: {
                    key: existingKey.key,
                    expiresAt: existingKey.expiresAt,
                    duration: existingKey.duration
                }
            });
        }
        
        // ===== 7. CREATE NEW KEY ENTRY =====
        const newKeyEntry = {
            key: key,
            username: username,
            duration: duration, // Store as string (hours or 'permanent')
            createdAt: new Date().toISOString(),
            expiresAt: expiresAt,
            renewCount: 0,
            lastRenewedAt: null
        };
        
        keys.push(newKeyEntry);
        console.log(`[GENERATE] Added new key entry. Total keys: ${keys.length}`);
        
        // ===== 8. SAVE TO GITHUB =====
        const newContent = JSON.stringify(keys, null, 2);
        
        try {
            await updateGitHubFile(
                GITHUB_OWNER,
                GITHUB_REPO,
                filePath,
                newContent,
                `Add key for ${username} (${durationText})`,
                GITHUB_TOKEN,
                sha
            );
            
            console.log(`[GENERATE] ✅ Successfully saved key to GitHub`);
        } catch (error) {
            console.error('[GENERATE] ❌ Failed to save to GitHub:', error.message);
            return res.status(500).json({ 
                success: false,
                error: 'Failed to save key to database: ' + error.message 
            });
        }
        
        // ===== 9. RETURN SUCCESS RESPONSE =====
        return res.status(200).json({
            success: true,
            message: `✅ Key berhasil dibuat untuk ${username}!`,
            key: key,
            username: username,
            duration: durationText,
            durationValue: duration,
            createdAt: newKeyEntry.createdAt,
            expiresAt: expiresAt,
            expiresAtFormatted: expiresAt ? new Date(expiresAt).toLocaleString('id-ID') : 'Never'
        });
        
    } catch (error) {
        // ===== 10. HANDLE ERRORS =====
        console.error('[GENERATE] ❌ Unexpected error:', error);
        
        return res.status(500).json({ 
            success: false,
            error: 'Terjadi kesalahan server: ' + error.message 
        });
    }
}
