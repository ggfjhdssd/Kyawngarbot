/**
 * ============================================================
 *  KYAW NGAR MINING BOT  —  bot.js  (ပြင်ဆင်ထားသောဗားရှင်း)
 *  ✅ Referral: Channel join ပြီးတာနဲ့ ချက်ချင်း 2000 ကျပ် + Noti
 *  ✅ Miner purchase: Frontend မှ multer screenshot → Admin sendPhoto
 *                     Approve/Reject inline button ဖြင့် User Noti
 *  ✅ Admin commands: /addmoney /reducemoney /ban /unban
 * ============================================================
 */

const TelegramBot = require('node-telegram-bot-api');
const express     = require('express');
const axios       = require('axios');

// ── Config ────────────────────────────────────────────────────
const BOT_TOKEN      = process.env.BOT_TOKEN;
const ADMIN_ID       = parseInt(process.env.ADMIN_ID);
const API_BASE_URL   = process.env.API_BASE_URL  || 'https://kyawngar-backend.onrender.com';
const WEB_APP_URL    = process.env.WEB_APP_URL   || 'https://kyawngarfrontend1.vercel.app';
const CHANNEL_LINK   = process.env.CHANNEL_LINK  || 'https://t.me/freeeemoneeeyi';
const CHANNEL_ID     = process.env.CHANNEL_ID    || '@freeeemoneeeyi';
const INVITE_REWARD  = 2000;

if (!BOT_TOKEN || !ADMIN_ID) {
  console.error('❌ Missing BOT_TOKEN or ADMIN_ID!');
  process.exit(1);
}

// ── State ─────────────────────────────────────────────────────
let bot, isPolling = false, restartAttempts = 0;
const MAX_RESTART = 5;

// ── Helpers ───────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function forceClearWebhook() {
  try {
    const r = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`);
    console.log('✅ Webhook cleared:', r.data.description);
  } catch (e) {
    console.error('❌ clearWebhook error:', e.message);
  }
}

async function isChannelMember(userId) {
  try {
    const r = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`, {
      params: { chat_id: CHANNEL_ID, user_id: userId }
    });
    return ['member', 'administrator', 'creator'].includes(r.data.result?.status);
  } catch { return false; }
}

// ── Welcome message ───────────────────────────────────────────
async function sendWelcome(chatId, firstName, refParam) {
  const url = refParam ? `${WEB_APP_URL}?startapp=${refParam}` : WEB_APP_URL;
  await bot.sendMessage(chatId,
    `မင်္ဂလာပါ *${firstName}* ခင်ဗျာ! 🙏\n` +
    `Kyaw Ngar Mining မှ ကြိုဆိုပါတယ်။\n\n` +
    `⛏️ *Miner ဝယ်ယူ:* ၁၀ မိနစ်တိုင်း 1,000 ကျပ် Auto ရှာပေးမည်\n` +
    `📺 *Tasks:* ကြော်ငြာကြည့်ပြီး ၃၀၀ ကျပ် ရယူပါ\n` +
    `👥 *Referral:* တစ်ယောက်ဖိတ်ပြီး ၂,၀၀၀ ကျပ် ရပါ\n` +
    `💸 *Withdraw:* ၅၀,၀၀၀ ကျပ် ပြည့်ပါက ထုတ်ယူနိုင်သည်\n\n` +
    `👇 App ဖွင့်ပြီး စတင်ပါ`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🚀 Open App', web_app: { url } }]]
      }
    }
  ).catch(() => {});
}

// ── Send channel-join prompt (with referral embedded in callback) ─
async function sendJoinPrompt(chatId, firstName, refCode) {
  // Embed refCode in callback_data so it survives the join step
  const cbData = refCode ? `joined_${chatId}_${refCode}` : `joined_${chatId}_`;
  await bot.sendMessage(chatId,
    `မင်္ဂလာပါ *${firstName}* ✋\n\n` +
    `⚠️ App ကို အသုံးပြုရန် ကျွန်ုပ်တို့ Channel ကို အရင် *Join* ဖြစ်ရပါမည်!\n\n` +
    `📢 Join ပြီးမှ ✅ ခလုတ်နှိပ်ပါ`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📢 Channel Join မည်', url: CHANNEL_LINK }],
          [{ text: '✅ Join ပြီးပြီ — ဆက်သွားမည်', callback_data: cbData }]
        ]
      }
    }
  ).catch(() => {});
}

// ── Award referral (idempotent) ───────────────────────────────
async function awardReferral(inviteeId, inviteeName, refCode) {
  if (!refCode) return;
  try {
    const res = await axios.post(`${API_BASE_URL}/api/bot/referral-award`, {
      inviteeId, inviteeName, refCode
    }, { timeout: 8000 });

    if (res.data?.success && res.data?.referrerId) {
      const referrerId = res.data.referrerId;
      const reward     = res.data.reward || INVITE_REWARD;
      // Send notification to referrer
      await bot.sendMessage(referrerId,
        `🎉 *သင်၏ Referral Link မှ လူသစ်တစ်ယောက် ဝင်ရောက်လာပါပြီ!*\n\n` +
        `👤 *${inviteeName}* သည် သင့် link မှတစ်ဆင့် ဝင်ရောက်လာသောကြောင့်\n` +
        `💰 *${reward.toLocaleString()} ကျပ်* သင့်အကောင့်သို့ ချက်ချင်းထည့်သွင်းပြီးပါပြီ!`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } catch (e) {
    console.warn('awardReferral error:', e.message);
  }
}

// ── Backend API helper ─────────────────────────────────────────
const BOT_INTERNAL_KEY = process.env.BOT_INTERNAL_KEY || 'kyawngar_internal_bot_key';

async function backendPost(path, body) {
  try {
    const r = await axios.post(`${API_BASE_URL}${path}`, body, {
      timeout: 10000,
      headers: { 'x-bot-key': BOT_INTERNAL_KEY }
    });
    return r.data;
  } catch (e) {
    console.warn(`backendPost ${path}:`, e.response?.data || e.message);
    return null;
  }
}

async function backendGet(path) {
  try {
    const r = await axios.get(`${API_BASE_URL}${path}`, {
      timeout: 10000,
      headers: { 'x-bot-key': BOT_INTERNAL_KEY }
    });
    return r.data;
  } catch (e) {
    console.warn(`backendGet ${path}:`, e.message);
    return null;
  }
}

// ============================================================
//  INITIALIZE BOT
// ============================================================
async function initializeBot() {
  console.log('🚀 Initializing bot...');
  await forceClearWebhook();
  await sleep(3000);

  bot = new TelegramBot(BOT_TOKEN, {
    polling: { interval: 300, autoStart: true, params: { timeout: 10 } }
  });
  isPolling = true;
  restartAttempts = 0;

  const me = await bot.getMe();
  console.log(`🤖 Bot ready: @${me.username}`);

  setupHandlers();
}

// ============================================================
//  HANDLERS
// ============================================================
function setupHandlers() {

  // ── /start ────────────────────────────────────────────────
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId    = msg.chat.id;
    const userId    = msg.from.id;
    const firstName = msg.from.first_name || 'User';
    const refCode   = match[1]?.trim() || '';

    try {
      const joined = await isChannelMember(userId);

      if (!joined) {
        // Persist pending ref code to backend so it survives restarts
        await backendPost('/api/bot/save-pending-ref', {
          userId, firstName,
          username: msg.from.username || '',
          refCode: refCode || null
        }).catch(() => {});
        await sendJoinPrompt(chatId, firstName, refCode);
        return;
      }

      // Already a member — process referral immediately
      if (refCode) {
        await awardReferral(userId, firstName, refCode);
      }
      await sendWelcome(chatId, firstName, refCode);

    } catch (e) {
      console.error('/start error:', e.message);
      bot.sendMessage(chatId, '❌ တစ်ခုခု မှားသွားပါသည်။ ထပ်ကြိုးစားပါ။').catch(() => {});
    }
  });

  // ── Callback queries (Join check, Miner Approve/Reject) ───
  bot.on('callback_query', async (cb) => {
    const chatId    = cb.message?.chat?.id;
    const userId    = cb.from?.id;
    const firstName = cb.from?.first_name || 'User';
    const data      = cb.data || '';

    await bot.answerCallbackQuery(cb.id).catch(() => {});

    // ── "joined_{userId}_{refCode}" ─────────────────────────
    if (data.startsWith('joined_')) {
      const parts   = data.split('_');
      // Format: joined_{targetUserId}_{refCode}
      // parts[0]=joined, parts[1]=targetUserId, rest=refCode
      const targetId = parseInt(parts[1]);
      const refCode  = parts.slice(2).join('_') || '';

      // Only respond to the user whose button it is
      if (userId !== targetId) {
        return bot.answerCallbackQuery(cb.id, { text: '❌ သင့်ခလုတ် မဟုတ်ပါ', show_alert: true }).catch(() => {});
      }

      const joined = await isChannelMember(userId);
      if (!joined) {
        return bot.answerCallbackQuery(cb.id, {
          text: '❌ Channel ကို Join မလုပ်ရသေးပါ! Join လုပ်ပြီးမှ ထပ်နှိပ်ပါ။',
          show_alert: true
        }).catch(() => {});
      }

      // Delete the join-prompt message
      bot.deleteMessage(chatId, cb.message.message_id).catch(() => {});

      // Retrieve saved pending ref from backend (fallback)
      let codeToUse = refCode;
      if (!codeToUse) {
        const saved = await backendGet(`/api/bot/pending-ref/${userId}`);
        codeToUse = saved?.refCode || '';
      }

      if (codeToUse) {
        await awardReferral(userId, firstName, codeToUse);
      }

      // Clear pending ref
      await backendPost('/api/bot/clear-pending-ref', { userId }).catch(() => {});
      await sendWelcome(chatId, firstName, codeToUse);
      return;
    }

    // ── "miner_approve_{minerId}_{userId}_{slot}" ────────────
    if (data.startsWith('miner_approve_')) {
      if (userId !== ADMIN_ID) return;
      const parts   = data.replace('miner_approve_', '').split('_');
      const minerId = parts[0];
      const mUserId = parseInt(parts[1]);
      const slot    = parts[2] || '?';

      const res = await backendPost('/api/admin/bot/miners/approve', { minerId });
      if (res?.success) {
        // Edit the admin message caption
        bot.editMessageCaption(
          cb.message?.caption?.replace(/\n\n_Approve.*$/s, '') + '\n\n✅ *APPROVED*',
          { chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'Markdown' }
        ).catch(() => {});

        // Notify user
        bot.sendMessage(mUserId,
          `✅ *Miner #${slot} Activate ပြုလုပ်ပြီးပါပြီ!*\n\n` +
          `Admin မှ သင့် Miner ကို confirm ပေးပါပြီ။\n` +
          `ယခု ၁၀ မိနစ်တိုင်း 1,000 ကျပ် Auto ရရှိနေပါမည်! ⛏️💰`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      } else {
        bot.answerCallbackQuery(cb.id, { text: '❌ Error: ' + (res?.error || 'Server error'), show_alert: true }).catch(() => {});
      }
      return;
    }

    // ── "miner_reject_{minerId}_{userId}_{slot}" ─────────────
    if (data.startsWith('miner_reject_')) {
      if (userId !== ADMIN_ID) return;
      const parts   = data.replace('miner_reject_', '').split('_');
      const minerId = parts[0];
      const mUserId = parseInt(parts[1]);
      const slot    = parts[2] || '?';

      const res = await backendPost('/api/admin/bot/miners/reject', { minerId });
      if (res?.success) {
        bot.editMessageCaption(
          cb.message?.caption?.replace(/\n\n_Approve.*$/s, '') + '\n\n❌ *REJECTED*',
          { chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'Markdown' }
        ).catch(() => {});

        bot.sendMessage(mUserId,
          `❌ *Miner #${slot} ငြင်းဆန်ခံရပါသည်။*\n\n` +
          `Screenshot မှန်ကန်မှု စစ်ဆေးပြီး ထပ်မံ တင်ပေးပါ။`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
      return;
    }
  });

  // ── Admin commands ─────────────────────────────────────────

  // /admin — help list
  bot.onText(/\/admin$/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    bot.sendMessage(msg.chat.id,
      `🛠 *Admin Commands*\n\n` +
      `/addmoney [UserID] [Amount] — ငွေထည့်ရန်\n` +
      `/reducemoney [UserID] [Amount] — ငွေနုတ်ရန်\n` +
      `/ban [UserID] [Reason] — User ပိတ်ရန်\n` +
      `/unban [UserID] — User ပြန်ဖွင့်ရန်\n` +
      `/userinfo [UserID] — User အချက်အလက်\n` +
      `/broadcast [message] — Users အားလုံးသို့ Noti\n` +
      `/reply [UserID] [message] — User ထံ စာပြန်ရန်\n` +
      `/stats — App statistics`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  });

  // /addmoney [userId] [amount]
  bot.onText(/\/addmoney (\d+) (\d+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1]);
    const amount   = parseInt(match[2]);

    const res = await backendPost('/api/admin/bot/addmoney', { userId: targetId, amount });
    if (res?.success) {
      bot.sendMessage(msg.chat.id,
        `✅ *ငွေထည့်ပြီးပါပြီ*\n` +
        `👤 User: ${targetId}\n` +
        `💰 ထည့်သော ငွေ: ${amount.toLocaleString()} ကျပ်\n` +
        `💳 လက်ကျန်ငွေ: ${res.newBalance?.toLocaleString()} ကျပ်`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      // Notify target user
      bot.sendMessage(targetId,
        `💰 *Admin မှ ငွေထည့်ပေးပါပြီ!*\n\n` +
        `✅ ${amount.toLocaleString()} ကျပ် သင့်အကောင့်သို့ ထည့်သွင်းပြီးပါပြီ\n` +
        `💳 လက်ကျန်ငွေ: ${res.newBalance?.toLocaleString()} ကျပ်`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } else {
      bot.sendMessage(msg.chat.id, `❌ ${res?.error || 'User မတွေ့ပါ'}`).catch(() => {});
    }
  });

  // /reducemoney [userId] [amount]
  bot.onText(/\/reducemoney (\d+) (\d+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1]);
    const amount   = parseInt(match[2]);

    const res = await backendPost('/api/admin/bot/reducemoney', { userId: targetId, amount });
    if (res?.success) {
      bot.sendMessage(msg.chat.id,
        `✅ *ငွေနုတ်ပြီးပါပြီ*\n` +
        `👤 User: ${targetId}\n` +
        `💸 နုတ်သော ငွေ: ${amount.toLocaleString()} ကျပ်\n` +
        `💳 လက်ကျန်ငွေ: ${res.newBalance?.toLocaleString()} ကျပ်`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      bot.sendMessage(targetId,
        `⚠️ *Admin မှ ငွေနုတ်ယူပါပြီ*\n\n` +
        `💸 ${amount.toLocaleString()} ကျပ် သင့်အကောင့်မှ နုတ်ယူပြီးပါပြီ\n` +
        `💳 လက်ကျန်ငွေ: ${res.newBalance?.toLocaleString()} ကျပ်`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } else {
      bot.sendMessage(msg.chat.id, `❌ ${res?.error || 'User မတွေ့ပါ သို့မဟုတ် ငွေလောက်မပြည့်ပါ'}`).catch(() => {});
    }
  });

  // /ban [userId] [reason]
  bot.onText(/\/ban (\d+)(?:\s+(.+))?/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1]);
    const reason   = match[2]?.trim() || 'Admin စစ်ဆေး';

    const res = await backendPost('/api/admin/bot/ban', { userId: targetId, reason });
    if (res?.success) {
      bot.sendMessage(msg.chat.id,
        `✅ *User ${targetId} ကို Ban ချပြီးပါပြီ*\n📝 Reason: ${reason}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      bot.sendMessage(targetId,
        `🚫 *Account ပိတ်ထားပါသည်*\n\n` +
        `Admin မှ သင့် Account ကို ပိတ်ဆို့ထားပါသည်\n` +
        `📝 အကြောင်းပြချက်: ${reason}\n\n` +
        `ပြဿနာရှိပါက Admin ထံ ဆက်သွယ်ပါ`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } else {
      bot.sendMessage(msg.chat.id, `❌ ${res?.error || 'User မတွေ့ပါ'}`).catch(() => {});
    }
  });

  // /unban [userId]
  bot.onText(/\/unban (\d+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1]);

    const res = await backendPost('/api/admin/bot/unban', { userId: targetId });
    if (res?.success) {
      bot.sendMessage(msg.chat.id,
        `✅ *User ${targetId} ကို Ban ဖြုတ်ပြီးပါပြီ*`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      bot.sendMessage(targetId,
        `✅ *Account ပြန်ဖွင့်ပေးပြီးပါပြီ!*\n\n` +
        `Admin မှ သင့် Account ကို ပြန်ဖွင့်ပေးပါပြီ\n` +
        `App ကို ပုံမှန်အသုံးပြုနိုင်ပါပြီ 🎉`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } else {
      bot.sendMessage(msg.chat.id, `❌ ${res?.error || 'User မတွေ့ပါ'}`).catch(() => {});
    }
  });

  // /userinfo [userId]
  bot.onText(/\/userinfo (\d+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1]);

    const res = await backendGet(`/api/admin/bot/userinfo/${targetId}`);
    if (res?.success && res.user) {
      const u = res.user;
      bot.sendMessage(msg.chat.id,
        `👤 *User Info*\n\n` +
        `🆔 ID: \`${u.userId}\`\n` +
        `📛 Name: ${u.firstName || '-'}\n` +
        `💰 Balance: ${u.balance?.toLocaleString()} ကျပ်\n` +
        `👥 Invites: ${u.inviteCount} ယောက်\n` +
        `🚫 Banned: ${u.banned ? 'Yes (' + u.banReason + ')' : 'No'}\n` +
        `⛏️ Miners: ${u.activeMiners || 0} active\n` +
        `📅 Joined: ${new Date(u.createdAt).toLocaleDateString('my-MM')}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } else {
      bot.sendMessage(msg.chat.id, `❌ User ${targetId} မတွေ့ပါ`).catch(() => {});
    }
  });

  // /stats
  bot.onText(/\/stats/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    const res = await backendGet('/api/admin/stats');
    if (res) {
      bot.sendMessage(msg.chat.id,
        `📊 *App Statistics*\n\n` +
        `👥 Total Users: ${res.totalUsers?.toLocaleString()}\n` +
        `⛏️ Active Miners: ${res.activeMiners?.toLocaleString()}\n` +
        `💸 Pending Withdrawals: ${res.pendingWithdrawals}\n` +
        `⏳ Pending Miners: ${res.pendingMiners?.length || 0}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  });

  // /reply [userId] [message]
  bot.onText(/\/reply (\d+) (.+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1]);
    const text     = match[2];
    try {
      await bot.sendMessage(targetId,
        `📨 *Admin ထံမှ အကြောင်းပြန်စာ*\n\n${text}`,
        { parse_mode: 'Markdown' }
      );
      bot.sendMessage(msg.chat.id, `✅ User ${targetId} ထံ စာပြန်ပြီးပါပြီ`).catch(() => {});
    } catch {
      bot.sendMessage(msg.chat.id, `❌ ပို့မရပါ — User က Bot ကို Block ထားနိုင်သည်`).catch(() => {});
    }
  });

  // /broadcast [message]
  bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const text = match[1];
    bot.sendMessage(msg.chat.id, '📢 Broadcast စတင်မည်...').catch(() => {});

    const data = await backendGet('/api/admin/users');
    const users = data?.users || [];
    let ok = 0, fail = 0;

    for (let i = 0; i < users.length; i += 30) {
      const batch = users.slice(i, i + 30);
      await Promise.all(batch.map(async u => {
        try {
          await bot.sendMessage(u.userId, text, { parse_mode: 'HTML' });
          ok++;
        } catch { fail++; }
      }));
      if (i + 30 < users.length) await sleep(2000);
    }
    bot.sendMessage(msg.chat.id,
      `✅ Broadcast ပြီးပါပြီ\n📤 Sent: ${ok}\n❌ Failed: ${fail}`
    ).catch(() => {});
  });

  // /giveminer [userId] [slot] — Grant miner to user
  bot.onText(/\/giveminer (\d+) ([123])/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId  = parseInt(match[1]);
    const slotIndex = parseInt(match[2]);

    const res = await backendPost('/api/admin/bot/giveminer', { userId: targetId, slotIndex });
    if (res?.success) {
      bot.sendMessage(msg.chat.id,
        `✅ *Miner Slot #${slotIndex} ပေးပြီးပါပြီ*\n` +
        `👤 User: ${targetId}\n` +
        `⛏️ Slot #${slotIndex} Active ဖြစ်ပြီ!`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      // Notify user
      bot.sendMessage(targetId,
        `🎁 *Admin မှ Miner ပေးပါပြီ!*\n\n` +
        `⛏️ *Slot #${slotIndex}* သင့်အတွက် Activate ပြုလုပ်ပြီးပါပြီ\n` +
        `ယခု ၁၀ မိနစ်တိုင်း 1,000 ကျပ် Auto ရရှိနေပါမည်! 💰`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } else {
      bot.sendMessage(msg.chat.id, `❌ ${res?.error || 'Error ဖြစ်သွားသည်'}`).catch(() => {});
    }
  });

  // /revokeminer [userId] [slot] — Remove miner from user
  bot.onText(/\/revokeminer (\d+) ([123])/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId  = parseInt(match[1]);
    const slotIndex = parseInt(match[2]);

    const res = await backendPost('/api/admin/bot/revokeminer', { userId: targetId, slotIndex });
    if (res?.success) {
      bot.sendMessage(msg.chat.id,
        `✅ *Miner Slot #${slotIndex} ဖြုတ်ပြီးပါပြီ*\n👤 User: ${targetId}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } else {
      bot.sendMessage(msg.chat.id, `❌ ${res?.error || 'Miner မတွေ့ပါ'}`).catch(() => {});
    }
  });

  // ── Non-command messages ────────────────────────────────────
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (userId === ADMIN_ID) return;
    if (msg.text?.startsWith('/')) return;

    // Forward text support messages to admin
    if (msg.text) {
      bot.sendMessage(ADMIN_ID,
        `📩 *Support Message*\n\n` +
        `👤 *${msg.from.first_name || ''}* (${userId})\n` +
        `💬 ${msg.text}\n\n` +
        `_Reply: /reply ${userId} <message>_`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      bot.sendMessage(chatId, '✅ Admin ထံ송 ပြီးပါပြီ').catch(() => {});
    }
  });

  // ── Polling error recovery ─────────────────────────────────
  bot.on('polling_error', async (err) => {
    console.error('Polling error:', err.message);
    if (err.message.includes('409') && restartAttempts < MAX_RESTART) {
      restartAttempts++;
      if (isPolling) { await bot.stopPolling().catch(() => {}); isPolling = false; }
      await forceClearWebhook();
      await sleep(5000);
      await initializeBot();
    }
  });
}

// ============================================================
//  EXPRESS SERVER  —  Backend မှ ခေါ်သော Endpoints
// ============================================================
const app = express();
app.use(express.json({ limit: '20mb' }));

app.get('/',       (_req, res) => res.send('🤖 Kyaw Ngar Mining Bot Running!'));
app.get('/health', (_req, res) => res.send('OK'));
app.get('/status', (_req, res) => res.json({ status: 'ok', polling: isPolling, ts: Date.now() }));

// ── Backend calls bot to notify admin with inline buttons ──
// POST /send-miner-photo  { userId, firstName, minerId, slotIndex, screenshotBuffer(base64) }
app.post('/send-miner-photo', async (req, res) => {
  if (!bot || !isPolling) return res.status(503).json({ error: 'Bot not ready' });
  const { userId, firstName, minerId, slotIndex, amount, screenshotBase64 } = req.body;
  if (!userId || !minerId || !screenshotBase64) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const slotPrices = { 1: 3000, 2: 5000, 3: 10000 };
  const price = amount || slotPrices[slotIndex] || 0;

  const caption =
    `⛏️ *Miner Purchase Request*\n\n` +
    `👤 *User:* ${firstName || userId}\n` +
    `🆔 *User ID:* \`${userId}\`\n` +
    `🔢 *Slot:* #${slotIndex}\n` +
    `💰 *Amount:* ${price.toLocaleString()} ကျပ်\n` +
    `🛒 *Miner ID:* \`${minerId}\`\n\n` +
    `_Approve or Reject below ↓_`;

  const inlineKeyboard = {
    inline_keyboard: [[
      { text: '✅ Approve',  callback_data: `miner_approve_${minerId}_${userId}_${slotIndex}` },
      { text: '❌ Reject',   callback_data: `miner_reject_${minerId}_${userId}_${slotIndex}` }
    ]]
  };

  try {
    const buf = Buffer.from(screenshotBase64, 'base64');
    await bot.sendPhoto(ADMIN_ID, buf, {
      caption,
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard
    });

    // Tell user to wait
    await bot.sendMessage(parseInt(userId),
      `⏳ *Miner ဝယ်ယူမှု လက်ခံပြီးပါပြီ!*\n\n` +
      `Screenshot ကို Admin ထံ တိုက်ရိုက်ပို့ပြီးပါပြီ\n` +
      `မကြာမီ Admin စစ်ဆေးပြီး Activate ပေးပါမည် 🙏`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    res.json({ success: true });
  } catch (e) {
    console.error('send-miner-photo error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Generic user notification (withdrawal etc.) ─────────────
app.post('/notify-user', async (req, res) => {
  if (!bot || !isPolling) return res.status(503).json({ error: 'Bot not ready' });
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: 'Missing fields' });

  try {
    await bot.sendMessage(parseInt(userId), message, { parse_mode: 'Markdown' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Error handler ──────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Express error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initializeBot().then(() => {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║  ⛏️  Kyaw Ngar Mining Bot  —  Ready!     ║
╠══════════════════════════════════════════╣
║  Port: ${String(PORT).padEnd(34)}║
║  Admin: ${String(ADMIN_ID).padEnd(33)}║
║  Referral ✅  Screenshot ✅  Admin ✅    ║
╚══════════════════════════════════════════╝`);
  });
}).catch(e => { console.error('Startup failed:', e); process.exit(1); });

process.once('SIGINT',  () => { if (bot) bot.stopPolling(); process.exit(0); });
process.once('SIGTERM', () => { if (bot) bot.stopPolling(); process.exit(0); });
