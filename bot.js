const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');

// ==================== Configuration ====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const API_BASE_URL = process.env.API_BASE_URL || 'https://kyawngar-backend.onrender.com';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://kyawngarfrontend1.vercel.app';
const CHANNEL_LINK = 'https://t.me/freeeemoneeeyi';
const CHANNEL_USERNAME = '@freeeemoneeeyi';
const INVITE_REWARD = 2000;

if (!BOT_TOKEN || !ADMIN_ID) {
    console.error('❌ Missing BOT_TOKEN or ADMIN_ID!');
    process.exit(1);
}

// ==================== Global Variables ====================
let bot;
let isPolling = false;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 5;

// ==================== Force clear webhook ====================
async function forceClearWebhook() {
    try {
        console.log('🔄 Force clearing webhook...');
        const res = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
        console.log('✅ Webhook cleared:', res.data.description);
        return true;
    } catch (err) {
        console.error('❌ Failed to clear webhook:', err.message);
        return false;
    }
}

// ==================== Check Channel Membership ====================
async function isChannelMember(userId) {
    try {
        const res = await axios.get(
            `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`,
            { params: { chat_id: CHANNEL_USERNAME, user_id: userId } }
        );
        const status = res.data.result?.status;
        return ['member', 'administrator', 'creator'].includes(status);
    } catch (err) {
        console.error('Channel check error:', err.message);
        return false;
    }
}

// ==================== Send Welcome Message ====================
async function sendWelcomeMessage(chatId, firstName, referrerId) {
    let webAppUrl = WEB_APP_URL;
    if (referrerId) {
        webAppUrl = `${WEB_APP_URL}?startapp=${referrerId}`;
    }

    const text =
        `မင်္ဂလာပါ ${firstName} ခင်ဗျာ! 🙏\n` +
        `Kyaw Ngar Mining မှ ကြိုဆိုပါတယ်။\n\n` +
        `ကျွန်ုပ်တို့၏ Mini App တွင် အောက်ပါတို့ကို လုပ်ဆောင်ပြီး ငွေရှာနိုင်ပါသည်\n\n` +
        `⛏️ Miner ဝယ်ယူခြင်း: ၁၀ မိနစ်လျှင် ၃၀၀ ကျပ် နှုန်းဖြင့် အလိုအလျောက် ငွေရှာပေးမည်\n\n` +
        `📺 Tasks: ကြော်ငြာကြည့်ပြီး တစ်ကြိမ်လျှင် ၃၀၀ ကျပ် ရယူပါ။\n\n` +
        `👥 Referral: သူငယ်ချင်းကို ဖိတ်ခေါ်ပြီး တစ်ယောက်လျှင် ၂၀၀၀ ကျပ် လက်ဆောင်ရယူပါ။\n\n` +
        `💸 Withdraw: အနည်းဆုံး ၅၀,၀၀၀ ကျပ် ပြည့်ပါက KPay / WavePay ဖြင့် ထုတ်ယူနိုင်ပါသည်\n\n` +
        `အောက်က "Open App" ခလုတ်ကိုနှိပ်ပြီး အခုပဲ စတင်လိုက်ပါ။ 👇`;

    await bot.sendMessage(chatId, text, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🚀 Open App', web_app: { url: webAppUrl } }]
            ]
        }
    });
}

// ==================== Initialize Bot ====================
async function initializeBot() {
    console.log('🚀 Initializing bot...');
    await forceClearWebhook();
    await new Promise(resolve => setTimeout(resolve, 3000));
    try {
        bot = new TelegramBot(BOT_TOKEN, { polling: true, onlyFirstMatch: true });
        isPolling = true;
        restartAttempts = 0;
        console.log('✅ Bot polling started');
        setupCommandHandlers();
        const me = await bot.getMe();
        console.log(`🤖 Bot connected: @${me.username}`);
    } catch (err) {
        console.error('❌ Failed to initialize bot:', err.message);
        throw err;
    }
}

// ==================== Command Handlers ====================
function setupCommandHandlers() {
    if (!bot) return;

    // /start command
    bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const firstName = msg.from.first_name || 'User';
        const startParam = match[1]?.trim(); // referral code or "join"

        console.log(`📩 /start from user ${userId}, param: ${startParam || 'none'}`);

        try {
            // Check channel membership
            const isMember = await isChannelMember(userId);

            if (!isMember) {
                // Not a member — prompt to join
                await bot.sendMessage(chatId,
                    `မင်္ဂလာပါ ${firstName} ခင်ဗျာ! 🙏\n\n` +
                    `Kyaw Ngar Mining Bot ကို အသုံးပြုရန် အရင်ဆုံး\n` +
                    `ကျွန်ုပ်တို့၏ Channel ကို Join ဖြစ်ရပါမည်။\n\n` +
                    `✅ Channel Join ပြီးနောက် /start ကို ထပ်နှိပ်ပါ။`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📢 Channel Join ရန်', url: CHANNEL_LINK }]
                            ]
                        }
                    }
                );
                return;
            }

            // Member — show welcome + handle referral
            // If referral param exists, register user with referral via backend
            if (startParam && startParam !== 'join') {
                // Trigger backend registration with referral code
                try {
                    await axios.post(`${API_BASE_URL}/api/users/register`, {
                        userId,
                        firstName,
                        username: msg.from.username || '',
                        referralCode: startParam
                    }, {
                        headers: { 'X-Telegram-Init-Data': `user=${userId}` },
                        timeout: 8000
                    });
                    console.log(`✅ Referral registration sent for user ${userId} with code ${startParam}`);
                } catch (err) {
                    // Registration might already exist — not critical
                    console.log(`ℹ️ Registration note for user ${userId}:`, err.response?.data?.error || err.message);
                }
            }

            await sendWelcomeMessage(chatId, firstName, startParam);

        } catch (err) {
            console.error('❌ /start error:', err.message);
            try {
                await bot.sendMessage(chatId, '❌ တစ်ခုခု မှားသွားပါသည်။ နောက်မှ ထပ်ကြိုးစားပါ။');
            } catch (_) {}
        }
    });

    // /join command — re-check membership
    bot.onText(/\/join/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const firstName = msg.from.first_name || 'User';

        try {
            const isMember = await isChannelMember(userId);
            if (!isMember) {
                await bot.sendMessage(chatId,
                    `❌ Channel ကို မ Join ရသေးပါ။\n\nChannel Join ပြီးမှ /start နှိပ်ပါ။`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📢 Channel Join ရန်', url: CHANNEL_LINK }]
                            ]
                        }
                    }
                );
            } else {
                await sendWelcomeMessage(chatId, firstName, null);
            }
        } catch (err) {
            console.error('❌ /join error:', err.message);
        }
    });

    // /admin command
    bot.onText(/\/admin/, (msg) => {
        const chatId = msg.chat.id;
        if (msg.from.id !== ADMIN_ID) {
            return bot.sendMessage(chatId, '⛔ Admin မဟုတ်ပါ။').catch(() => {});
        }
        bot.sendMessage(chatId, '👑 Admin Panel', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👑 Open Admin Panel', web_app: { url: `${WEB_APP_URL}/admin.html` } }]
                ]
            }
        }).catch(err => console.error('❌ Admin error:', err));
    });

    // Forward non-command user messages to admin
    bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/')) return;
        if (msg.from.id === ADMIN_ID) return;

        // Check if it's a screenshot/photo — forward to admin
        if (msg.photo || msg.document) {
            try {
                const caption = `📸 *Screenshot from user*\n👤 ${msg.from.first_name || ''}\n🆔 \`${msg.from.id}\``;
                if (msg.photo) {
                    const fileId = msg.photo[msg.photo.length - 1].file_id;
                    await bot.sendPhoto(ADMIN_ID, fileId, { caption, parse_mode: 'Markdown' });
                } else if (msg.document) {
                    await bot.sendDocument(ADMIN_ID, msg.document.file_id, { caption, parse_mode: 'Markdown' });
                }
                await bot.sendMessage(msg.chat.id, '✅ Screenshot ကို Admin ထံ ပို့ပြီးပါပြီ။ မကြာမီ confirm ပေးပါမည်။');
            } catch (err) {
                console.error('❌ Photo forward error:', err.message);
            }
            return;
        }

        // Text message forward
        try {
            const forwardMsg =
                `📩 *Support Message*\n\n` +
                `👤 *User:* ${msg.from.first_name || ''} ${msg.from.last_name || ''}\n` +
                `🆔 *User ID:* \`${msg.from.id}\`\n` +
                `📝 *Message:*\n${msg.text}\n\n` +
                `_Reply: /reply ${msg.from.id} <message>_`;
            await bot.sendMessage(ADMIN_ID, forwardMsg, { parse_mode: 'Markdown' });
            await bot.sendMessage(msg.chat.id, '✅ သင့်စာကို Admin ထံ ပို့ပြီးပါပြီ။');
        } catch (err) {
            console.error('❌ Message forward error:', err.message);
        }
    });

    // /reply command for admin
    bot.onText(/\/reply (\d+) (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (msg.from.id !== ADMIN_ID) {
            return bot.sendMessage(chatId, '⛔ Admin မဟုတ်ပါ။');
        }
        const targetUserId = parseInt(match[1]);
        const replyText = match[2];
        try {
            await bot.sendMessage(targetUserId,
                `📨 *Admin ထံမှ အကြောင်းပြန်စာ*\n\n${replyText}`,
                { parse_mode: 'Markdown' }
            );
            await bot.sendMessage(chatId, `✅ User ${targetUserId} ထံ စာပြန်ပြီးပါပြီ။`);
        } catch (err) {
            console.error(`❌ Reply error to ${targetUserId}:`, err.message);
            await bot.sendMessage(chatId, `❌ ပို့မရပါ။ User က Bot ကို block ထားနိုင်သည်။`);
        }
    });

    // Polling error recovery
    bot.on('polling_error', async (error) => {
        console.error('❌ Polling error:', error.message);
        if (error.message.includes('409') || error.message.includes('Conflict')) {
            console.log('🔄 409 Conflict — restarting...');
            restartAttempts++;
            if (restartAttempts > MAX_RESTART_ATTEMPTS) {
                console.error('❌ Too many restarts, exiting...');
                process.exit(1);
            }
            try {
                if (isPolling) { await bot.stopPolling(); isPolling = false; }
                await forceClearWebhook();
                await new Promise(r => setTimeout(r, 5000));
                await initializeBot();
            } catch (e) {
                console.error('❌ Recovery failed:', e.message);
            }
        }
    });
}

// ==================== Express Server ====================
const app = express();
app.use(express.json({ limit: '20mb' }));

app.get('/', (req, res) => res.send('🤖 Kyaw Ngar Mining Bot is Running!'));
app.get('/health', (req, res) => res.send('OK'));
app.get('/status', (req, res) => res.json({
    status: 'ok',
    polling: isPolling,
    timestamp: new Date().toISOString()
}));

// ==================== Referral Notification (called by backend) ====================
app.post('/referral-notify', async (req, res) => {
    const { referrerId, newUserId, newUserName, reward } = req.body;
    if (!referrerId || !newUserId) {
        return res.status(400).json({ error: 'Missing referrerId or newUserId' });
    }
    if (!bot || !isPolling) return res.status(503).json({ error: 'Bot not ready' });

    try {
        const amount = reward || INVITE_REWARD;
        const message =
            `🎉 *လူသစ်တစ်ယောက် ဝင်ရောက်လာပါပြီ!*\n\n` +
            `👤 *${newUserName || `User ${newUserId}`}* သည် သင့် referral link မှ ဝင်ရောက်လာပါသည်။\n` +
            `💰 *${amount.toLocaleString()} ကျပ်* သင့်အကောင့်သို့ ထည့်သွင်းပြီးပါပြီ!\n\n` +
            `Kyaw Ngar Mining`;

        await bot.sendMessage(parseInt(referrerId), message, { parse_mode: 'Markdown' });
        console.log(`✅ Referral notify sent to ${referrerId}`);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Referral notify error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== Miner Purchase Notify (Screenshot → Admin) ====================
app.post('/miner-purchase-notify', async (req, res) => {
    const { userId, userName, minerId, slotIndex, screenshotData } = req.body;
    if (!bot || !isPolling) return res.status(503).json({ error: 'Bot not ready' });

    try {
        const caption =
            `⛏️ *Miner Purchase Request*\n\n` +
            `👤 *User:* ${userName || userId}\n` +
            `🆔 *User ID:* \`${userId}\`\n` +
            `🔢 *Slot:* #${slotIndex}\n` +
            `🛒 *Miner ID:* \`${minerId}\`\n\n` +
            `Kpay: 09783646736 (Yee Mon Naing)\n` +
            `Wave: 09790611406 (Aye Thandar)\n\n` +
            `Confirm: /approve_miner_${minerId}\n` +
            `Reject: /reject_miner_${minerId}`;

        if (screenshotData) {
            const base64Clean = screenshotData.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Clean, 'base64');
            await bot.sendPhoto(ADMIN_ID, buffer, { caption, parse_mode: 'Markdown' });
        } else {
            await bot.sendMessage(ADMIN_ID, caption, { parse_mode: 'Markdown' });
        }

        // Notify user to wait
        await bot.sendMessage(parseInt(userId),
            `⏳ *Miner ဝယ်ယူမှု လက်ခံပါပြီ!*\n\n` +
            `Screenshot ကို Admin ထံ ပို့ပြီးပါပြီ။\n` +
            `မကြာမီ Admin စစ်ဆေးပြီး activate ပေးပါမည်။ 🙏`,
            { parse_mode: 'Markdown' }
        ).catch(() => {});

        console.log(`✅ Miner purchase notify sent to admin for user ${userId}`);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Miner purchase notify error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== Miner Approved/Rejected Notify ====================
app.post('/miner-status-notify', async (req, res) => {
    const { userId, slotIndex, status } = req.body;
    if (!bot || !isPolling) return res.status(503).json({ error: 'Bot not ready' });

    try {
        let message;
        if (status === 'active') {
            message =
                `✅ *Miner #${slotIndex} Activate ပြုလုပ်ပြီးပါပြီ!*\n\n` +
                `Admin မှ သင့် Miner ကို confirm ပေးပါပြီ။\n` +
                `ယခု ၁၀ မိနစ်တိုင်း ၃၀၀ ကျပ် အလိုအလျောက် ရရှိနေပါမည်။ ⛏️💰`;
        } else {
            message =
                `❌ *Miner #${slotIndex} ငြင်းဆန်ခံရပါသည်။*\n\n` +
                `Admin မှ confirm မပေးပါ။\n` +
                `Screenshot မှန်ကန်မှု စစ်ဆေးပြီး ထပ်မံ တင်ပေးပါ။`;
        }

        await bot.sendMessage(parseInt(userId), message, { parse_mode: 'Markdown' });
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Miner status notify error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== Withdrawal Notification ====================
app.post('/withdrawal-notify', async (req, res) => {
    const { userId, amount, method, status, reason, adminId } = req.body;
    if (adminId !== ADMIN_ID) return res.status(403).json({ error: 'Unauthorized' });
    if (!userId || !amount || !status) return res.status(400).json({ error: 'Missing fields' });
    if (!bot || !isPolling) return res.status(503).json({ error: 'Bot not ready' });

    try {
        const now = new Date().toLocaleString('my-MM', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        let message;
        if (status === 'completed') {
            message =
                `🎊 *ငွေထုတ်ယူမှု အောင်မြင်ပါသည်!* 🎊\n\n` +
                `💰 *ပမာဏ:* \`${amount.toLocaleString()} ကျပ်\`\n` +
                `🏦 *နည်းလမ်း:* ${method ? method.toUpperCase() : 'N/A'}\n` +
                `🕒 *အချိန်:* ${now}\n\n` +
                `သင်၏ Wallet/Bank App တွင် ပြန်လည်စစ်ဆေးပေးပါ။ 🙏`;
        } else if (status === 'rejected') {
            message =
                `❌ *ငွေထုတ်ယူမှု ငြင်းပယ်ခံရပါသည်။*\n\n` +
                `⚠️ *အကြောင်းပြချက်:* ${reason || 'မရှိပါ'}\n` +
                `💰 *${amount.toLocaleString()} ကျပ်* ကို သင့်အကောင့်ထဲ ပြန်ထည့်ပေးပြီးပါပြီ။\n` +
                `🕒 *အချိန်:* ${now}`;
        } else {
            return res.status(400).json({ error: 'Invalid status' });
        }

        await bot.sendMessage(parseInt(userId), message, { parse_mode: 'Markdown' });
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Withdrawal notify error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== Broadcast ====================
app.post('/broadcast', async (req, res) => {
    const { message, adminId } = req.body;
    if (adminId !== ADMIN_ID) return res.status(403).json({ error: 'Unauthorized' });
    if (!bot || !isPolling) return res.status(503).json({ error: 'Bot not ready' });

    res.status(202).json({ status: 'started' });
    (async () => {
        let successCount = 0, failCount = 0;
        try {
            const usersRes = await axios.get(`${API_BASE_URL}/api/admin/users`, {
                headers: { 'X-Admin-Key': process.env.ADMIN_KEY || '' },
                timeout: 15000
            });
            const users = usersRes.data.users || [];
            console.log(`📢 Broadcast to ${users.length} users...`);
            for (let i = 0; i < users.length; i += 50) {
                const batch = users.slice(i, i + 50);
                await Promise.all(batch.map(async (user) => {
                    try {
                        await bot.sendMessage(user.userId, message, { parse_mode: 'HTML' });
                        successCount++;
                    } catch (e) {
                        failCount++;
                    }
                }));
                if (i + 50 < users.length) await new Promise(r => setTimeout(r, 3000));
            }
            console.log(`✅ Broadcast done. OK: ${successCount}, Fail: ${failCount}`);
        } catch (err) {
            console.error('Broadcast error:', err.message);
        }
    })();
});

// ==================== Error Handler ====================
app.use((err, req, res, next) => {
    console.error('❌ Express error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// ==================== Start Server ====================
const PORT = process.env.PORT || 3000;

initializeBot().then(() => {
    app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════╗
║  ⛏️  Kyaw Ngar Mining Bot Ready!     ║
╠══════════════════════════════════════╣
║ 📡 Port: ${PORT.toString().padEnd(29)} ║
║ 👑 Admin ID: ${ADMIN_ID.toString().padEnd(26)} ║
║ 📢 Channel: freeeemoneeeyi            ║
║ 🔄 Polling: Active                    ║
╚══════════════════════════════════════╝
        `);
    });
}).catch(err => {
    console.error('❌ Failed to start:', err);
    process.exit(1);
});

process.once('SIGINT', () => { if (bot && isPolling) bot.stopPolling(); process.exit(0); });
process.once('SIGTERM', () => { if (bot && isPolling) bot.stopPolling(); process.exit(0); });
