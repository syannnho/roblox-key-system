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
    // Security: Check if request is from Vercel Cron
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
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
            return res.status(200).json({ 
                message: 'Tidak ada file keys untuk dibersihkan',
                deletedCount: 0
            });
        }
        
        const content = Buffer.from(file.content, 'base64').toString('utf-8');
        const keys = JSON.parse(content);
        
        const now = new Date();
        const initialCount = keys.length;
        
        // Filter out expired keys
        const activeKeys = keys.filter(keyData => {
            if (!keyData.expiresAt) {
                return true; // Permanent keys
            }
            const expiryDate = new Date(keyData.expiresAt);
            return expiryDate > now;
        });
        
        const deletedCount = initialCount - activeKeys.length;
        
        if (deletedCount > 0) {
            // Update GitHub file
            const newContent = JSON.stringify(activeKeys, null, 2);
            await updateGitHubFile(
                GITHUB_OWNER,
                GITHUB_REPO,
                filePath,
                newContent,
                `Cleanup: Removed ${deletedCount} expired key(s)`,
                GITHUB_TOKEN,
                file.sha
            );
        }
        
        return res.status(200).json({
            success: true,
            message: `Cleanup selesai`,
            deletedCount: deletedCount,
            remainingKeys: activeKeys.length
        });
        
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Terjadi kesalahan: ' + error.message 
        });
    }
}
