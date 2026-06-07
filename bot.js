require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, proto } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const express = require('express');
const execPromise = util.promisify(exec);

// ============ CONFIGURATION ============
const ADMINS = process.env.ADMINS ? process.env.ADMINS.split(',') : [];
const BOT_PREFIX = process.env.BOT_PREFIX || '!';
const DOWNLOAD_DIR = './downloads';
const MAX_STORAGE_MB = parseInt(process.env.MAX_STORAGE_MB) || 512;

// Settings file path
const SETTINGS_FILE = path.join(__dirname, 'database', 'settings.json');

// Ensure directories exist
fs.ensureDirSync(DOWNLOAD_DIR);
fs.ensureDirSync('./database');
fs.ensureDirSync('./auth_info');

// Load settings
let settings = fs.readJsonSync(SETTINGS_FILE, { throws: false }) || {
    welcomeMessage: "🎬 *WELCOME TO VIDEO DOWNLOADER BOT* 🎬\n\nSend me any video link from the platforms below and I'll download it for you!\n\n*Supported Platforms:*\n• YouTube\n• Instagram\n• Facebook\n• TikTok\n• X (Twitter)\n\n*How to use:*\n1️⃣ Send me a video link\n2️⃣ Choose quality (1080p/720p/480p)\n3️⃣ Download immediately!\n\n*Commands:*\n!menu - Show this menu\n!help - Show all commands\n!status - Bot status\n\n*Note:* Videos available for ~30 days. Save to gallery to keep forever.",
    disclaimer: "⚠️ *DISCLAIMER* ⚠️\n\nThis bot downloads videos from public URLs only.\n\n• Videos are available in this chat for approximately 30 days\n• Save videos to your gallery to keep them forever\n• Don't clear this chat or videos will be deleted\n• I don't store any videos on my servers\n\nFor issues or suggestions, contact admin.",
    welcomeImageUrl: "",
    admins: []
};

// Save settings function
function saveSettings() {
    fs.writeJsonSync(SETTINGS_FILE, settings, { spaces: 2 });
}

// Merge admins from .env and settings
const allAdmins = [...new Set([...ADMINS, ...settings.admins])];

// ============ PLATFORM BUTTONS ============
const platformButtons = [
    { buttonId: `platform_youtube`, buttonText: { displayText: `▶️ YouTube` }, type: 1 },
    { buttonId: `platform_instagram`, buttonText: { displayText: `📸 Instagram` }, type: 1 },
    { buttonId: `platform_facebook`, buttonText: { displayText: `📘 Facebook` }, type: 1 },
    { buttonId: `platform_tiktok`, buttonText: { displayText: `🎵 TikTok` }, type: 1 },
    { buttonId: `platform_x`, buttonText: { displayText: `🐦 X (Twitter)` }, type: 1 }
];

// ============ URL DETECTION ============
function getPlatformFromUrl(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('instagram.com')) return 'instagram';
    if (url.includes('facebook.com') || url.includes('fb.watch')) return 'facebook';
    if (url.includes('tiktok.com')) return 'tiktok';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'x';
    return null;
}

function isDownloadableUrl(text) {
    const patterns = [
        /(?:https?:\/\/)?(?:www\.)?(youtu\.be\/|youtube\.com\/)/,
        /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(p|reel|tv|stories)\//,
        /(?:https?:\/\/)?(?:www\.)?(facebook\.com|fb\.watch)\//,
        /(?:https?:\/\/)?(?:www\.)?(tiktok\.com\/@[\w]+\/video\/|vm\.tiktok\.com\/)/,
        /(?:https?:\/\/)?(?:www\.)?(twitter\.com|x\.com)\/[\w]+\/status\//
    ];
    return patterns.some(pattern => pattern.test(text));
}

// ============ DOWNLOAD FUNCTION ============
async function downloadVideo(url, quality = 'best') {
    const timestamp = Date.now();
    let format = '';
    
    switch(quality) {
        case '1080p': format = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]'; break;
        case '720p': format = 'bestvideo[height<=720]+bestaudio/best[height<=720]'; break;
        case '480p': format = 'bestvideo[height<=480]+bestaudio/best[height<=480]'; break;
        default: format = 'best';
    }
    
    const outputPath = path.join(DOWNLOAD_DIR, `video_${timestamp}.%(ext)s`);
    const command = `yt-dlp -f "${format}" --merge-output-format mp4 -o "${outputPath}" "${url}"`;
    
    try {
        await execPromise(command, { timeout: 300000 });
        const files = await fs.readdir(DOWNLOAD_DIR);
        const downloadedFile = files.find(f => f.includes(timestamp.toString()));
        if (downloadedFile) {
            return path.join(DOWNLOAD_DIR, downloadedFile);
        }
        return null;
    } catch (error) {
        console.error('Download error:', error);
        return null;
    }
}

// ============ ADMIN COMMANDS ============
async function handleAdminCommand(command, args, sender, sock) {
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();
    
    switch(cmd) {
        case 'addadmin':
            if (!args) {
                await sock.sendMessage(sender, { text: "❌ Usage: !addadmin <number>\nExample: !addadmin 919876543210" });
                return;
            }
            const newAdmin = args.replace(/[^0-9]/g, '');
            if (!settings.admins.includes(newAdmin)) {
                settings.admins.push(newAdmin);
                saveSettings();
                await sock.sendMessage(sender, { text: `✅ Added ${newAdmin} as admin` });
            } else {
                await sock.sendMessage(sender, { text: `⚠️ ${newAdmin} is already an admin` });
            }
            break;
            
        case 'deladmin':
        case 'removeadmin':
            if (!args) {
                await sock.sendMessage(sender, { text: "❌ Usage: !deladmin <number>" });
                return;
            }
            const removeAdmin = args.replace(/[^0-9]/g, '');
            const index = settings.admins.indexOf(removeAdmin);
            if (index !== -1) {
                settings.admins.splice(index, 1);
                saveSettings();
                await sock.sendMessage(sender, { text: `✅ Removed ${removeAdmin} from admins` });
            } else {
                await sock.sendMessage(sender, { text: `⚠️ ${removeAdmin} is not an admin` });
            }
            break;
            
        case 'adddisclaimer':
            if (!args) {
                await sock.sendMessage(sender, { text: "❌ Usage: !adddisclaimer <your disclaimer text>" });
                return;
            }
            settings.disclaimer = args;
            saveSettings();
            await sock.sendMessage(sender, { text: "✅ Disclaimer updated successfully!" });
            break;
            
        case 'deldiclaimer':
        case 'deletedisclaimer':
            settings.disclaimer = "";
            saveSettings();
            await sock.sendMessage(sender, { text: "✅ Disclaimer deleted!" });
            break;
            
        case 'showdisclaimer':
            if (settings.disclaimer) {
                await sock.sendMessage(sender, { text: settings.disclaimer });
            } else {
                await sock.sendMessage(sender, { text: "ℹ️ No disclaimer set." });
            }
            break;
            
        case 'addwelcome':
            if (!args) {
                await sock.sendMessage(sender, { text: "❌ Usage: !addwelcome <your welcome message>" });
                return;
            }
            settings.welcomeMessage = args;
            saveSettings();
            await sock.sendMessage(sender, { text: "✅ Welcome message updated successfully!" });
            break;
            
        case 'delwelcome':
        case 'deletewelcome':
            settings.welcomeMessage = "🎬 *VIDEO DOWNLOADER BOT* 🎬\n\nSend me a video link to download!\n\nSupported: YouTube, Instagram, Facebook, TikTok, X\n\n!menu - Show menu\n!help - Help";
            saveSettings();
            await sock.sendMessage(sender, { text: "✅ Welcome message reset to default!" });
            break;
            
        case 'showwelcome':
            await sock.sendMessage(sender, { text: settings.welcomeMessage });
            break;
            
        case 'addwelcomeimage':
            await sock.sendMessage(sender, { text: "⚠️ Send me the image you want as welcome image" });
            // Store that we're waiting for image
            global.waitingForWelcomeImage = sender;
            break;
            
        case 'delwelcomeimage':
            settings.welcomeImageUrl = "";
            saveSettings();
            await sock.sendMessage(sender, { text: "✅ Welcome image removed!" });
            break;
            
        case 'adminmenu':
            const menu = `*👑 ADMIN CONTROL MENU* 👑\n\n` +
                        `📋 *Message Settings:*\n` +
                        `!addwelcome <text> - Set welcome message\n` +
                        `!delwelcome - Delete welcome message\n` +
                        `!showwelcome - Show current welcome\n` +
                        `!adddisclaimer <text> - Set disclaimer\n` +
                        `!deletedisclaimer - Delete disclaimer\n` +
                        `!showdisclaimer - Show disclaimer\n` +
                        `!addwelcomeimage - Set welcome image (send image after)\n` +
                        `!delwelcomeimage - Remove welcome image\n\n` +
                        `👥 *Admin Management:*\n` +
                        `!addadmin <number> - Add admin\n` +
                        `!deladmin <number> - Remove admin\n` +
                        `!listadmins - Show all admins\n\n` +
                        `🛠️ *Bot Controls:*\n` +
                        `!stats - Bot statistics\n` +
                        `!clean - Clear download cache\n` +
                        `!restart - Restart bot (Render only)\n\n` +
                        `!adminmenu - Show this menu`;
            await sock.sendMessage(sender, { text: menu });
            break;
            
        case 'listadmins':
            const adminList = settings.admins.length > 0 ? settings.admins.join('\n') : "No additional admins";
            await sock.sendMessage(sender, { text: `*📋 Admin List*\n\n${adminList}` });
            break;
            
        case 'stats':
            const files = await fs.readdir(DOWNLOAD_DIR);
            const totalSize = files.length;
            await sock.sendMessage(sender, { text: `📊 *Bot Statistics*\n\n📁 Cached files: ${totalSize}\n👑 Admins: ${settings.admins.length}\n🕐 Uptime: ${process.uptime().toFixed(0)} seconds` });
            break;
            
        case 'clean':
            await fs.emptyDir(DOWNLOAD_DIR);
            await sock.sendMessage(sender, { text: "🗑️ Download cache cleaned!" });
            break;
            
        default:
            await sock.sendMessage(sender, { text: "❌ Unknown admin command. Type !adminmenu for help." });
    }
}

// ============ SEND WELCOME MESSAGE ============
async function sendWelcomeMessage(sock, sender) {
    if (settings.welcomeImageUrl && settings.welcomeImageUrl !== "") {
        try {
            await sock.sendMessage(sender, {
                image: { url: settings.welcomeImageUrl },
                caption: settings.welcomeMessage,
                buttons: platformButtons,
                footer: "Select a platform to get started"
            });
        } catch (error) {
            await sock.sendMessage(sender, {
                text: settings.welcomeMessage,
                buttons: platformButtons,
                footer: "Select a platform to get started"
            });
        }
    } else {
        await sock.sendMessage(sender, {
            text: settings.welcomeMessage,
            buttons: platformButtons,
            footer: "Select a platform to get started"
        });
    }
}

// ============ MAIN BOT ============
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: P({ level: 'silent' }),
        browser: ['WhatsApp Bot', 'Chrome', '120.0.0']
    });
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('========== SCAN THIS QR WITH WHATSAPP ==========');
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('[BOT] Connection closed');
            if (shouldReconnect) {
                console.log('[BOT] Reconnecting in 5 seconds...');
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('[BOT] ✅ Bot is running!');
            console.log('[BOT] Admins:', [...ADMINS, ...settings.admins].join(', '));
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const isAdmin = allAdmins.includes(sender.split('@')[0]) || allAdmins.includes(sender);
        
        // Handle welcome image upload
        if (global.waitingForWelcomeImage === sender && msg.message?.imageMessage) {
            const media = await sock.downloadMediaMessage(msg);
            const imagePath = path.join(DOWNLOAD_DIR, 'welcome_image.jpg');
            await fs.writeFile(imagePath, media);
            settings.welcomeImageUrl = imagePath;
            saveSettings();
            delete global.waitingForWelcomeImage;
            await sock.sendMessage(sender, { text: "✅ Welcome image set successfully!" });
            return;
        } else if (global.waitingForWelcomeImage === sender) {
            delete global.waitingForWelcomeImage;
            await sock.sendMessage(sender, { text: "❌ No image received. Please send an image." });
            return;
        }
        
        // Handle button responses
        if (msg.message?.buttonsResponseMessage) {
            const buttonId = msg.message.buttonsResponseMessage.selectedButtonId;
            if (buttonId && buttonId.startsWith('platform_')) {
                const platform = buttonId.replace('platform_', '');
                await sock.sendMessage(sender, {
                    text: `📹 *${platform.toUpperCase()} Downloader*\n\nSend me a ${platform} video link and I'll download it for you!\n\nExample: https://${platform}.com/...`
                });
            }
            return;
        }
        
        // Handle commands
        if (text.startsWith(BOT_PREFIX)) {
            const command = text.slice(1).toLowerCase();
            
            // Admin commands
            if (isAdmin && (command.startsWith('addadmin') || command.startsWith('deladmin') || 
                command.startsWith('adddisclaimer') || command.startsWith('deletedisclaimer') ||
                command.startsWith('addwelcome') || command.startsWith('delwelcome') ||
                command.startsWith('addwelcomeimage') || command.startsWith('delwelcomeimage') ||
                command.startsWith('showwelcome') || command.startsWith('showdisclaimer') ||
                command === 'adminmenu' || command === 'listadmins' || command === 'stats' ||
                command === 'clean' || command === 'removeadmin')) {
                const args = text.slice(1 + command.split(' ')[0].length + 1);
                await handleAdminCommand(command, args, sender, sock);
                return;
            }
            
            // Public commands
            switch(command) {
                case 'menu':
                case 'start':
                    await sendWelcomeMessage(sock, sender);
                    break;
                case 'help':
                    await sock.sendMessage(sender, {
                        text: `*🤖 BOT COMMANDS* 🤖\n\n` +
                              `!menu / !start - Show welcome menu\n` +
                              `!help - Show this help\n` +
                              `!status - Bot status\n\n` +
                              `*How to use:*\n` +
                              `1️⃣ Send any video link\n` +
                              `2️⃣ Choose quality\n` +
                              `3️⃣ Download and save!\n\n` +
                              `*Supported platforms:*\n` +
                              `▶️ YouTube | 📸 Instagram | 📘 Facebook | 🎵 TikTok | 🐦 X`
                    });
                    break;
                case 'status':
                    await sock.sendMessage(sender, { 
                        text: `✅ *Bot is running!*\n\n` +
                              `Supported: YouTube, Instagram, Facebook, TikTok, X\n` +
                              `Send any video link to get started!` 
                    });
                    break;
                default:
                    await sock.sendMessage(sender, { text: "❌ Unknown command. Type !help for available commands." });
            }
            return;
        }
        
        // Auto-detect video links (ignore all other messages)
        if (text && isDownloadableUrl(text)) {
            const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
                const videoUrl = urlMatch[0];
                const platform = getPlatformFromUrl(videoUrl);
                
                let platformEmoji = '🎬';
                if (platform === 'youtube') platformEmoji = '▶️';
                else if (platform === 'instagram') platformEmoji = '📸';
                else if (platform === 'facebook') platformEmoji = '📘';
                else if (platform === 'tiktok') platformEmoji = '🎵';
                else if (platform === 'x') platformEmoji = '🐦';
                
                // Send disclaimer first if exists
                if (settings.disclaimer) {
                    await sock.sendMessage(sender, { text: settings.disclaimer });
                }
                
                // Send quality buttons
                const buttons = [
                    { buttonId: `quality_1080p_${videoUrl}`, buttonText: { displayText: `${platformEmoji} 1080p HD` }, type: 1 },
                    { buttonId: `quality_720p_${videoUrl}`, buttonText: { displayText: `${platformEmoji} 720p` }, type: 1 },
                    { buttonId: `quality_480p_${videoUrl}`, buttonText: { displayText: `${platformEmoji} 480p` }, type: 1 },
                    { buttonId: `quality_best_${videoUrl}`, buttonText: { displayText: `${platformEmoji} Best Quality` }, type: 1 }
                ];
                
                await sock.sendMessage(sender, {
                    text: `📥 *${platform.toUpperCase()} video detected!*\n\nChoose your preferred quality:`,
                    buttons: buttons,
                    footer: "Video downloader bot"
                });
            }
            return;
        }
        
        // Ignore all other messages (no responses to random texts)
        // Just silently ignore
    });
    
    // Keep-alive server for Render
    const app = express();
    const PORT = process.env.PORT || 3000;
    app.get('/', (req, res) => res.send('WhatsApp Bot is running!'));
    app.listen(PORT, () => console.log(`[WEB] Keep-alive server on port ${PORT}`));
}

// ============ START ============
console.log('========================================');
console.log('   WhatsApp Multi-Downloader Bot');
console.log('   YouTube | Instagram | Facebook | TikTok | X');
console.log('========================================');
console.log('[BOT] Starting...');

startBot().catch(err => {
    console.error('[BOT] Fatal error:', err);
    setTimeout(startBot, 10000);
});
