/**
 * ============================================================
 *  KYAW NGAR MINING BOT  —  bot.js  (အပြည့်အစုံ Fix v2)
 *  ✅ Referral: Channel join ပြီးတာနဲ့ ချက်ချင်း 2000 ကျပ် + Noti
 *  ✅ Miner purchase: Frontend မှ screenshot → Admin sendPhoto
 *                     Approve/Reject inline button ဖြင့် User Noti
 *  ✅ Admin commands: /addmoney /reducemoney /ban /unban etc.
 *
 *  🔧 BUG FIX v2 (bitcoin-bot နဲ့ စစ်ဆေးပြီး ပြင်ဆင်ထားတာ):
 *  ✅ FIX #1 — MAX_RESTART ရောက်ရင် bot ထာဝရ dead မဖြစ်တော့ပါ
 *              (10 မိနစ်ကြာ နောက်ထပ် retry လုပ်သည်)
 *  ✅ FIX #2 — Watchdog Interval Leak မဖြစ်တော့ပါ
 *              (Module-level variable ဖြင့် old interval ကို clear လုပ်သည်)
 *  ✅ FIX #3 — Polling Silent Death ကို စစ်ဆေးနိုင်ပြီ
 *              (lastUpdateTime track လုပ်ပြီး 10+ မိနစ် update မရရင် restart)
 *  ✅ FIX #4 — my_chat_member event (Block/Unblock) ကို handle လုပ်ပြီ
 *              (User block/unblock ဖြစ်ရင် bot ကိုမထိမချဘဲ log ထုတ်ကာ ဆက်)
 *  ✅ FIX #5 — isPolling state မမှန်ကန်မှု ပြင်ပြီ
 *  ✅ FIX #6 — 403 Forbidden error (user blocked) ကို sendMessage တိုင်း
 *              safely catch လုပ်ပြီ
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
let bot         = null;
let isPolling   = false;
let isRestarting = false;
let restartAttempts = 0;
const MAX_RESTART = 10;

// [FIX #2] — Watchdog interval ကို module-level မှာ သိမ်းပြီး leak မဖြစ်အောင်
let watchdogTimer = null;

// [FIX #3] — Polling silent death စစ်ဆေးရန် last update time track
let lastUpdateTime = Date.now();

// ── Helpers ───────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Safe sendMessage (403 block error ကို silently ignore) ────
async function safeSend(chatId, text, opts = {}) {
  if (!bot || !isPolling) return null;
  try {
    return await bot.sendMessage(chatId, text, opts);
  } catch (e) {
    // 403 Forbidden = user blocked bot → log ထုတ်ပြီး ဆက်
    if (e.response?.statusCode === 403 || (e.message || '').includes('403') || (e.message || '').includes('Forbidden') || (e.message || '').includes('blocked')) {
      console.warn(`⚠️  safeSend: User ${chatId} has blocked the bot. Skipping.`);
      return null;
    }
    // 400 Bad Request (e.g. chat not found) → log ထုတ်ပြီး ဆက်
    if (e.response?.statusCode === 400 || (e.message || '').includes('400')) {
      console.warn(`⚠️  safeSend: Bad request for chatId ${chatId}: ${e.message}`);
      return null;
    }
    console.error(`❌ safeSend error (chatId ${chatId}):`, e.message);
    return null;
  }
}

// ── Global Process Error Handlers ─────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unhandled Rejection:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️  Uncaught Exception:', err.message);
});

// ── Webhook clear ──────────────────────────────────────────────
async function forceClearWebhook() {
  try {
    const r = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`,
      { timeout: 10000 }
    );
    console.log('✅ Webhook cleared:', r.data.description);
  } catch (e) {
    console.error('❌ clearWebhook error:', e.message);
  }
}

async function isChannelMember(userId) {
  try {
    const r = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`, {
      params: { chat_id: CHANNEL_ID, user_id: userId },
      timeout: 8000
    });
    return ['member', 'administrator', 'creator'].includes(r.data.result?.status);
  } catch {
    return false;
  }
}

// ── Welcome message ───────────────────────────────────────────
async function sendWelcome(chatId, firstName, refParam) {
  const url = refParam ? `${WEB_APP_URL}?startapp=${refParam}` : WEB_APP_URL;
  await safeSend(chatId,
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
  );
}

// ── Channel join prompt ───────────────────────────────────────
async function sendJoinPrompt(chatId, firstName, refCode) {
  const cbData = refCode ? `joined_${chatId}_${refCode}` : `joined_${chatId}_`;
  await safeSend(chatId,
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
  );
}

// ── Award referral ────────────────────────────────────────────
async function awardReferral(inviteeId, inviteeName, refCode) {
  if (!refCode) return;
  try {
    const res = await axios.post(`${API_BASE_URL}/api/bot/referral-award`, {
      inviteeId, inviteeName, refCode
    }, { timeout: 8000 });

    if (res.data?.success && res.data?.referrerId) {
      const referrerId = res.data.referrerId;
      const reward     = res.data.reward || INVITE_REWARD;
      await safeSend(referrerId,
        `🎉 *သင်၏ Referral Link မှ လူသစ်တစ်ယောက် ဝင်ရောက်လာပါပြီ!*\n\n` +
        `👤 *${inviteeName}* သည် သင့် link မှတစ်ဆင့် ဝင်ရောက်လာသောကြောင့်\n` +
        `💰 *${reward.toLocaleString()} ကျပ်* သင့်အကောင့်သို့ ချက်ချင်းထည့်သွင်းပြီးပါပြီ!`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (e) {
    console.warn('awardReferral error:', e.message);
  }
}

// ── Backend API helpers ───────────────────────────────────────
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
//  [FIX #2 + #1] WATCHDOG — Module-level, no leak
//  Interval ကို module level မှာ သိမ်း၊ restart တိုင်း clear လုပ်ပြီး
//  အသစ် create မှသာ ဖြစ်မည်
// ============================================================
function startWatchdog() {
  // Old watchdog ရှိရင် ဖျက်ပြီးမှ အသစ် start
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }

  watchdogTimer = setInterval(async () => {
    if (!bot || !isPolling || isRestarting) return;

    try {
      // [FIX #5] — getMe() စစ်ဆေးခြင်း
      await bot.getMe();

      // [FIX #3] — Polling silent death စစ်ဆေးခြင်း
      // 10 မိနစ် update မရရင် polling သေနေတာ ဖြစ်နိုင်
      const minutesSinceUpdate = (Date.now() - lastUpdateTime) / 60000;
      if (minutesSinceUpdate > 10) {
        console.warn(`🔍 Watchdog: No updates for ${minutesSinceUpdate.toFixed(1)} min — possible polling death. Restarting...`);
        restartBot('watchdog_no_updates');
      }

    } catch (e) {
      console.error('🔍 Watchdog: getMe() failed — bot may be down:', e.message);
      if (!isRestarting) {
        restartBot('watchdog_getme_failed');
      }
    }
  }, 5 * 60 * 1000); // 5 မိနစ်တိုင်း စစ်ဆေး

  console.log('🔍 Watchdog started.');
}

// ============================================================
//  [FIX #1] RESTART BOT — MAX_RESTART ရောက်ရင်
//  ထာဝရ dead မဖြစ်ဘဲ 10 မိနစ်ကြာပြီး ထပ်ကြိုးစားမည်
// ============================================================
async function restartBot(reason = '') {
  if (isRestarting) {
    console.log('⏳ Already restarting, skipping...');
    return;
  }

  // [FIX #1] MAX_RESTART ရောက်ရင် ထာဝရ ရပ်မနေဘဲ 10 မိနစ်ကြာပြီး retry
  if (restartAttempts >= MAX_RESTART) {
    console.error(`❌ Max restart attempts (${MAX_RESTART}) reached. Waiting 10 min before retry...`);
    restartAttempts = 0; // reset counter ပြန်
    await sleep(10 * 60 * 1000); // 10 မိနစ် စောင့်
    console.log('🔄 Retrying after max-restart cooldown...');
    // fall through — attempt restart below
  }

  isRestarting = true;
  restartAttempts++;
  const delay = Math.min(3000 * restartAttempts, 30000); // max 30s

  console.log(`\n🔄 Bot Restart [${restartAttempts}/${MAX_RESTART}] — Reason: ${reason}`);
  console.log(`⏳ Waiting ${delay / 1000}s before restart...`);

  try {
    // [FIX #2] — Old watchdog ကို ဖျက်
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }

    // Old bot ရဲ့ listeners အားလုံး ဖျက်
    if (bot) {
      bot.removeAllListeners();
      if (isPolling) {
        await bot.stopPolling().catch(() => {});
        isPolling = false;
      }
      bot = null;
    }

    await sleep(delay);
    await forceClearWebhook();
    await sleep(2000);
    await initializeBot();

  } catch (e) {
    console.error('❌ Restart failed:', e.message);
    isRestarting = false;
    setTimeout(() => restartBot('restart_failed_retry'), 10000);
  }
}

// ============================================================
//  INITIALIZE BOT
// ============================================================
async function initializeBot() {
  console.log('🚀 Initializing bot...');

  bot = new TelegramBot(BOT_TOKEN, {
    polling: {
      interval: 300,
      autoStart: true,
      params: { timeout: 10 }
    }
  });

  isPolling       = true;
  isRestarting    = false;
  restartAttempts = 0;
  lastUpdateTime  = Date.now(); // [FIX #3] reset update time

  const me = await bot.getMe();
  console.log(`🤖 Bot ready: @${me.username}`);

  setupHandlers();
  startWatchdog(); // [FIX #2] — Watchdog ကို module-level function မှ start
}

// ============================================================
//  HANDLERS
// ============================================================
function setupHandlers() {

  // [FIX #3] — Update ရတိုင်း lastUpdateTime refresh
  bot.on('message', (msg) => {
    lastUpdateTime = Date.now();
  });
  bot.on('callback_query', () => {
    lastUpdateTime = Date.now();
  });

  // ── [FIX #4] my_chat_member — User Block/Unblock event ──
  // User က bot ကို block/unblock လုပ်ရင် Telegram မှ ဤ event ပို့
  // Polling ကိုမထိဘဲ log ထုတ်ကာ ဆက်သွား
  bot.on('my_chat_member', (update) => {
    const newStatus = update.new_chat_member?.status;
    const userId    = update.from?.id;
    if (newStatus === 'kicked') {
      console.warn(`⚠️  [my_chat_member] User ${userId} has BLOCKED the bot. Polling unaffected.`);
    } else if (newStatus === 'member') {
      console.log(`ℹ️  [my_chat_member] User ${userId} has UNBLOCKED the bot.`);
    }
    // ─── Polling မထိ — ဆက်သွားသည် ───
  });

  // ── /start ────────────────────────────────────────────────
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    lastUpdateTime = Date.now(); // [FIX #3]
    const chatId    = msg.chat.id;
    const userId    = msg.from.id;
    const firstName = msg.from.first_name || 'User';
    const refCode   = match[1]?.trim() || '';

    try {
      const joined = await isChannelMember(userId);

      if (!joined) {
        await backendPost('/api/bot/save-pending-ref', {
          userId, firstName,
          username: msg.from.username || '',
          refCode: refCode || null
        });
        await sendJoinPrompt(chatId, firstName, refCode);
        return;
      }

      if (refCode) {
        await awardReferral(userId, firstName, refCode);
      }
      await sendWelcome(chatId, firstName, refCode);

    } catch (e) {
      console.error('/start error:', e.message);
      // [FIX #6] — error reply ကို safeSend သုံး (block ဖြစ်နေရင် crash မဖြစ်ရန်)
      await safeSend(chatId, '❌ တစ်ခုခု မှားသွားပါသည်။ ထပ်ကြိုးစားပါ။');
    }
  });

  // ── Callback queries ──────────────────────────────────────
  bot.on('callback_query', async (cb) => {
    lastUpdateTime = Date.now(); // [FIX #3]
    const chatId    = cb.message?.chat?.id;
    const userId    = cb.from?.id;
    const firstName = cb.from?.first_name || 'User';
    const data      = cb.data || '';

    // answerCallbackQuery ကို safeguard ထည့်ပြီး call
    try { await bot.answerCallbackQuery(cb.id); } catch {}

    // ── "joined_{userId}_{refCode}" ─────────────────────────
    if (data.startsWith('joined_')) {
      const parts    = data.split('_');
      const targetId = parseInt(parts[1]);
      const refCode  = parts.slice(2).join('_') || '';

      if (userId !== targetId) {
        try {
          await bot.answerCallbackQuery(cb.id, {
            text: '❌ သင့်ခလုတ် မဟုတ်ပါ', show_alert: true
          });
        } catch {}
        return;
      }

      const joined = await isChannelMember(userId);
      if (!joined) {
        try {
          await bot.answerCallbackQuery(cb.id, {
            text: '❌ Channel ကို Join မလုပ်ရသေးပါ! Join လုပ်ပြီးမှ ထပ်နှိပ်ပါ။',
            show_alert: true
          });
        } catch {}
        return;
      }

      try { await bot.deleteMessage(chatId, cb.message.message_id); } catch {}

      let codeToUse = refCode;
      if (!codeToUse) {
        const saved = await backendGet(`/api/bot/pending-ref/${userId}`);
        codeToUse = saved?.refCode || '';
      }

      if (codeToUse) {
        await awardReferral(userId, firstName, codeToUse);
      }

      await backendPost('/api/bot/clear-pending-ref', { userId });
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
        try {
          await bot.editMessageCaption(
            (cb.message?.caption || '').replace(/\n\n_Approve.*$/s, '') + '\n\n✅ *APPROVED*',
            { chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'Markdown' }
          );
        } catch {}
        await safeSend(mUserId,
          `✅ *Miner #${slot} Activate ပြုလုပ်ပြီးပါပြီ!*\n\n` +
          `Admin မှ သင့် Miner ကို confirm ပေးပါပြီ။\n` +
          `ယခု ၁၀ မိနစ်တိုင်း 1,000 ကျပ် Auto ရရှိနေပါမည်! ⛏️💰`,
          { parse_mode: 'Markdown' }
        );
      } else {
        try {
          await bot.answerCallbackQuery(cb.id, {
            text: '❌ Error: ' + (res?.error || 'Server error'), show_alert: true
          });
        } catch {}
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
        try {
          await bot.editMessageCaption(
            (cb.message?.caption || '').replace(/\n\n_Approve.*$/s, '') + '\n\n❌ *REJECTED*',
            { chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'Markdown' }
          );
        } catch {}
        await safeSend(mUserId,
          `❌ *Miner #${slot} ငြင်းဆန်ခံရပါသည်။*\n\n` +
          `Screenshot မှန်ကန်မှု စစ်ဆေးပြီး ထပ်မံ တင်ပေးပါ။`,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    // ── "wd_approve_{wdId}_{userId}" ────────────────────────
    if (data.startsWith('wd_approve_')) {
      if (userId !== ADMIN_ID) return;
      const parts   = data.replace('wd_approve_', '').split('_');
      const wdId    = parts[0];
      const wUserId = parseInt(parts[1]);

      const res = await backendPost('/api/admin/bot/approve-wd', { withdrawalId: wdId });
      if (res?.success) {
        try {
          await bot.editMessageCaption(
            (cb.message?.caption || '') + '\n\n✅ *APPROVED*',
            { chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'Markdown' }
          );
        } catch {}
        await safeSend(wUserId,
          `✅ *ငွေထုတ်မှု ခွင့်ပြုပြီးပါပြီ!*\n\n` +
          `💰 ${(res.amount || 0).toLocaleString()} ကျပ် မကြာမီ ငွေလွှဲပေးပါမည် 🙏`,
          { parse_mode: 'Markdown' }
        );
      } else {
        try {
          await bot.answerCallbackQuery(cb.id, {
            text: '❌ ' + (res?.error || 'Error'), show_alert: true
          });
        } catch {}
      }
      return;
    }

    // ── "wd_reject_{wdId}_{userId}" ─────────────────────────
    if (data.startsWith('wd_reject_')) {
      if (userId !== ADMIN_ID) return;
      const parts   = data.replace('wd_reject_', '').split('_');
      const wdId    = parts[0];
      const wUserId = parseInt(parts[1]);

      const res = await backendPost('/api/admin/bot/reject-wd', { withdrawalId: wdId });
      if (res?.success) {
        try {
          await bot.editMessageCaption(
            (cb.message?.caption || '') + '\n\n❌ *REJECTED (Refunded)*',
            { chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'Markdown' }
          );
        } catch {}
        await safeSend(wUserId,
          `❌ *ငွေထုတ်မှု ငြင်းဆန်ခံရပါသည်*\n\n` +
          `💰 ငွေ ပြန်ထည့်ပေးပြီးပါပြီ\nAdmin ထံ ဆက်သွယ်ပါ`,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }
  });

  // ── /approve_miner_[ID] ───────────────────────────────────
  bot.onText(/^\/approve_miner_([a-zA-Z0-9]+)$/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const minerId = match[1];
    const chatId  = msg.chat.id;

    const res = await backendPost('/api/admin/bot/miners/approve', { minerId });
    if (res?.success) {
      await safeSend(chatId,
        `✅ *Miner Slot #${res.slotIndex} ခွင့်ပြုပြီးပါပြီ*\n👤 User ID: ${res.userId}`,
        { parse_mode: 'Markdown' }
      );
      await safeSend(res.userId,
        `✅ *Miner #${res.slotIndex} Activate ပြုလုပ်ပြီးပါပြီ!*\n\nAdmin မှ confirm ပေးပါပြီ\nယခု ၁၀ မိနစ်တိုင်း 1,000 ကျပ် ⛏️💰`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(chatId, `❌ ${res?.error || 'Miner မတွေ့ပါ သို့မဟုတ် Error ဖြစ်သွားသည်'}`);
    }
  });

  // ── /reject_miner_[ID] ────────────────────────────────────
  bot.onText(/^\/reject_miner_([a-zA-Z0-9]+)$/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const minerId = match[1];
    const chatId  = msg.chat.id;

    const res = await backendPost('/api/admin/bot/miners/reject', { minerId });
    if (res?.success) {
      await safeSend(chatId,
        `❌ *Miner Slot #${res.slotIndex} ငြင်းဆန်ပြီးပါပြီ*\n👤 User ID: ${res.userId}`,
        { parse_mode: 'Markdown' }
      );
      await safeSend(res.userId,
        `❌ *Miner #${res.slotIndex} ငြင်းဆန်ခံရပါသည်*\n\nScreenshot မှန်ကန်မှု စစ်ဆေးပြီး ထပ်မံ တင်ပေးပါ`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(chatId, `❌ ${res?.error || 'Miner မတွေ့ပါ'}`);
    }
  });

  // ── /vpn ──────────────────────────────────────────────────
  bot.onText(/^\/vpn$/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    const res = await backendPost('/api/admin/bot/setvpn', { enabled: true });
    if (res?.success) {
      await safeSend(msg.chat.id,
        `🔒 *VPN Control: ဖွင့်ပြီးပါပြီ*\n\nယခုမှစ၍ မြန်မာနိုင်ငံမှ User များသည်\nTask ကြည့်ရန် VPN ဖွင့်ထားရမည်ဖြစ်သည်\n\n📴 ပိတ်ရန် /unvpn`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(msg.chat.id, `❌ Error: ${res?.error || 'Server error'}`);
    }
  });

  // ── /unvpn ────────────────────────────────────────────────
  bot.onText(/^\/unvpn$/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    const res = await backendPost('/api/admin/bot/setvpn', { enabled: false });
    if (res?.success) {
      await safeSend(msg.chat.id,
        `🔓 *VPN Control: ပိတ်ပြီးပါပြီ*\n\nယခုမှစ၍ VPN မပါဘဲ Task ကြည့်၍ ရပါပြီ\n\n🔒 ပြန်ဖွင့်ရန် /vpn`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(msg.chat.id, `❌ Error: ${res?.error || 'Server error'}`);
    }
  });

  // ── /setmin [amount] ──────────────────────────────────────
  bot.onText(/^\/setmin\s+(\d+)$/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const amount = parseInt(match[1]);
    if (amount < 1000) {
      await safeSend(msg.chat.id, '❌ အနည်းဆုံး 1,000 ကျပ် ဖြစ်ရမည်');
      return;
    }
    const res = await backendPost('/api/admin/bot/setmin', { amount });
    if (res?.success) {
      await safeSend(msg.chat.id,
        `✅ *Minimum Withdrawal ပြောင်းပြီးပါပြီ*\n\n💰 အနည်းဆုံး: *${amount.toLocaleString()} ကျပ်*`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(msg.chat.id, `❌ Error: ${res?.error || 'Server error'}`);
    }
  });

  // ── /setfee [amount] ──────────────────────────────────────
  bot.onText(/^\/setfee\s+(\d+)$/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const amount = parseInt(match[1]);
    const res = await backendPost('/api/admin/bot/setfee', { amount });
    if (res?.success) {
      await safeSend(msg.chat.id,
        `✅ *Withdrawal Fee ပြောင်းပြီးပါပြီ*\n\n💸 ကြေး: *${amount.toLocaleString()} ကျပ်*`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(msg.chat.id, `❌ Error: ${res?.error || 'Server error'}`);
    }
  });

  // ── /settings ─────────────────────────────────────────────
  bot.onText(/^\/settings$/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    const res = await backendGet('/api/admin/bot/getsettings');
    if (res?.success) {
      await safeSend(msg.chat.id,
        `⚙️ *Current Settings*\n\n` +
        `🔒 VPN Required: ${res.vpnRequired ? '✅ On' : '❌ Off'}\n` +
        `💰 Min Withdrawal: ${(res.minWithdrawal || 50000).toLocaleString()} ကျပ်\n` +
        `💸 Withdrawal Fee: ${(res.withdrawalFee || 5000).toLocaleString()} ကျပ်\n\n` +
        `📋 *Commands:*\n` +
        `/vpn — VPN ဖွင့်\n/unvpn — VPN ပိတ်\n` +
        `/setmin [ပမာဏ] — Min ပြောင်း\n/setfee [ကြေး] — Fee ပြောင်း`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // ── /admin ────────────────────────────────────────────────
  bot.onText(/\/admin$/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    await safeSend(msg.chat.id,
      `🛠 *Admin Commands*\n\n` +
      `💰 *ငွေ*\n` +
      `/addmoney [ID] [Amount] — ငွေထည့်ရန်\n` +
      `/reducemoney [ID] [Amount] — ငွေနုတ်ရန်\n\n` +
      `⛏️ *Miner*\n` +
      `/miner [ID] [miner1/2/3] — Miner ပေးရန်\n` +
      `/giveminer [ID] [1/2/3] — Miner ပေးရန်\n` +
      `/revokeminer [ID] [1/2/3] — Miner ဖြုတ်ရန်\n` +
      `/approve_miner_[ID] — Text မှ Miner Approve\n` +
      `/reject_miner_[ID] — Text မှ Miner Reject\n\n` +
      `⚙️ *Settings*\n` +
      `/vpn — VPN ဖွင့်\n/unvpn — VPN ပိတ်\n` +
      `/setmin [ပမာဏ] — Min Withdrawal ပြောင်း\n` +
      `/setfee [ကြေး] — Withdrawal Fee ပြောင်း\n` +
      `/settings — လက်ရှိ Settings ကြည့်\n\n` +
      `👤 *User*\n` +
      `/ban [ID] [Reason] — User ပိတ်ရန်\n` +
      `/unban [ID] — User ပြန်ဖွင့်ရန်\n` +
      `/userinfo [ID] — User အချက်အလက်\n\n` +
      `📢 *အခြား*\n` +
      `/broadcast [message] — Noti ပို့ရန်\n` +
      `/reply [ID] [message] — User ထံ စာပြန်ရန်\n` +
      `/stats — Users/Balance Statistics`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /addmoney [userId] [amount] ───────────────────────────
  bot.onText(/\/addmoney (\d+) (\d+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1]);
    const amount   = parseInt(match[2]);

    const res = await backendPost('/api/admin/bot/addmoney', { userId: targetId, amount });
    if (res?.success) {
      await safeSend(msg.chat.id,
        `✅ *ငွေထည့်ပြီးပါပြီ*\n` +
        `👤 User: ${targetId}\n` +
        `💰 ထည့်သော ငွေ: ${amount.toLocaleString()} ကျပ်\n` +
        `💳 လက်ကျန်ငွေ: ${res.newBalance?.toLocaleString()} ကျပ်`,
        { parse_mode: 'Markdown' }
      );
      await safeSend(targetId,
        `💰 *Admin မှ ငွေထည့်ပေးပါပြီ!*\n\n` +
        `✅ ${amount.toLocaleString()} ကျပ် သင့်အကောင့်သို့ ထည့်သွင်းပြီးပါပြီ\n` +
        `💳 လက်ကျန်ငွေ: ${res.newBalance?.toLocaleString()} ကျပ်`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(msg.chat.id, `❌ ${res?.error || 'User မတွေ့ပါ'}`);
    }
  });

  // ── /reducemoney [userId] [amount] ───────────────────────
  bot.onText(/\/reducemoney (\d+) (\d+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1]);
    const amount   = parseInt(match[2]);

    const res = await backendPost('/api/admin/bot/reducemoney', { userId: targetId, amount });
    if (res?.success) {
      await safeSend(msg.chat.id,
        `✅ *ငွေနုတ်ပြီးပါပြီ*\n` +
        `👤 User: ${targetId}\n` +
        `💸 နုတ်သော ငွေ: ${amount.toLocaleString()} ကျပ်\n` +
        `💳 လက်ကျန်ငွေ: ${res.newBalance?.toLocaleString()} ကျပ်`,
        { parse_mode: 'Markdown' }
      );
      await safeSend(targetId,
        `⚠️ *Admin မှ ငွေနုတ်ယူပါပြီ*\n\n` +
        `💸 ${amount.toLocaleString()} ကျပ် သင့်အကောင့်မှ နုတ်ယူပြီးပါပြီ\n` +
        `💳 လက်ကျန်ငွေ: ${res.newBalance?.toLocaleString()} ကျပ်`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(msg.chat.id, `❌ ${res?.error || 'User မတွေ့ပါ သို့မဟုတ် ငွေလောက်မပြည့်ပါ'}`);
    }
  });

  // ── /ban [userId] [reason] ────────────────────────────────
  bot.onText(/\/ban (\d+)(?:\s+(.+))?/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1]);
    const reason   = match[2]?.trim() || 'Admin စစ်ဆေး';

    const res = await backendPost('/api/admin/bot/ban', { userId: targetId, reason });
    if (res?.success) {
      await safeSend(msg.chat.id,
        `✅ *User ${targetId} ကို Ban ချပြီးပါပြီ*\n📝 Reason: ${reason}`,
        { parse_mode: 'Markdown' }
      );
      await safeSend(targetId,
        `🚫 *Account ပိတ်ထားပါသည်*\n\n` +
        `Admin မှ သင့် Account ကို ပိတ်ဆို့ထားပါသည်\n` +
        `📝 အကြောင်းပြချက်: ${reason}\n\n` +
        `ပြဿနာရှိပါက Admin ထံ ဆက်သွယ်ပါ`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(msg.chat.id, `❌ ${res?.error || 'User မတွေ့ပါ'}`);
    }
  });

  // ── /unban [userId] ───────────────────────────────────────
  bot.onText(/\/unban (\d+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1]);

    const res = await backendPost('/api/admin/bot/unban', { userId: targetId });
    if (res?.success) {
      await safeSend(msg.chat.id,
        `✅ *User ${targetId} ကို Ban ဖြုတ်ပြီးပါပြီ*`,
        { parse_mode: 'Markdown' }
      );
      // [FIX #6] — Unban လုပ်ပြီး user ကို notify
      // User က block မထားပါက reply ရမည်၊ block ထားရင် safeSend က silently ignore
      await safeSend(targetId,
        `✅ *Account ပြန်ဖွင့်ပေးပြီးပါပြီ!*\n\n` +
        `Admin မှ သင့် Account ကို ပြန်ဖွင့်ပေးပါပြီ\n` +
        `App ကို ပုံမှန်အသုံးပြုနိုင်ပါပြီ 🎉`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(msg.chat.id, `❌ ${res?.error || 'User မတွေ့ပါ'}`);
    }
  });

  // ── /userinfo [userId] ────────────────────────────────────
  bot.onText(/\/userinfo (\d+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1]);

    const res = await backendGet(`/api/admin/bot/userinfo/${targetId}`);
    if (res?.success && res.user) {
      const u = res.user;
      await safeSend(msg.chat.id,
        `👤 *User Info*\n\n` +
        `🆔 ID: \`${u.userId}\`\n` +
        `📛 Name: ${u.firstName || '-'}\n` +
        `💰 Balance: ${u.balance?.toLocaleString()} ကျပ်\n` +
        `👥 Invites: ${u.inviteCount} ယောက်\n` +
        `🚫 Banned: ${u.banned ? 'Yes (' + u.banReason + ')' : 'No'}\n` +
        `⛏️ Miners: ${u.activeMiners || 0} active\n` +
        `📅 Joined: ${new Date(u.createdAt).toLocaleDateString('my-MM')}`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(msg.chat.id, `❌ User ${targetId} မတွေ့ပါ`);
    }
  });

  // ── /stats ────────────────────────────────────────────────
  bot.onText(/\/stats/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    const res = await backendGet('/api/admin/stats');
    if (res) {
      await safeSend(msg.chat.id,
        `📊 *App Statistics*\n\n` +
        `👥 *Total Users:* ${res.totalUsers?.toLocaleString()} ယောက်\n` +
        `💰 *Total Balance (All Users):* ${(res.totalBalance || 0).toLocaleString()} ကျပ်\n` +
        `⛏️ *Active Miners:* ${res.activeMiners?.toLocaleString()}\n` +
        `💸 *Pending Withdrawals:* ${res.pendingWithdrawals}\n` +
        `⏳ *Pending Miners:* ${res.pendingMiners?.length || 0}`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // ── /reply [userId] [message] ─────────────────────────────
  bot.onText(/\/reply (\d+) (.+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1]);
    const text     = match[2];

    const result = await safeSend(targetId,
      `📨 *Admin ထံမှ အကြောင်းပြန်စာ*\n\n${text}`,
      { parse_mode: 'Markdown' }
    );

    if (result) {
      await safeSend(msg.chat.id, `✅ User ${targetId} ထံ စာပြန်ပြီးပါပြီ`);
    } else {
      await safeSend(msg.chat.id, `❌ ပို့မရပါ — User က Bot ကို Block ထားနိုင်သည်`);
    }
  });

  // ── /broadcast [message] ──────────────────────────────────
  bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const text = match[1];
    await safeSend(msg.chat.id, '📢 Broadcast စတင်မည်...');

    const data  = await backendGet('/api/admin/users');
    const users = data?.users || [];
    let ok = 0, fail = 0;

    for (let i = 0; i < users.length; i += 30) {
      const batch = users.slice(i, i + 30);
      await Promise.all(batch.map(async u => {
        // [FIX #6] safeSend သုံး — blocked user တွေကြောင့် crash မဖြစ်ရန်
        const r = await safeSend(u.userId, text, { parse_mode: 'HTML' });
        if (r) ok++; else fail++;
      }));
      if (i + 30 < users.length) await sleep(2000);
    }

    await safeSend(msg.chat.id,
      `✅ Broadcast ပြီးပါပြီ\n📤 Sent: ${ok}\n❌ Failed/Blocked: ${fail}`
    );
  });

  // ── /miner [userId] [miner1/miner2/miner3] ───────────────
  bot.onText(/\/miner (\d+) (miner[123])/i, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId  = parseInt(match[1]);
    const slotIndex = parseInt(match[2].replace(/miner/i, ''));

    const res = await backendPost('/api/admin/bot/giveminer', { userId: targetId, slotIndex });
    if (res?.success) {
      await safeSend(msg.chat.id,
        `✅ *Miner ${match[2].toUpperCase()} ပေးပြီးပါပြီ*\n` +
        `👤 User ID: ${targetId}\n` +
        `⛏️ Slot #${slotIndex} ယခု Active ဖြစ်ပြီ!`,
        { parse_mode: 'Markdown' }
      );
      await safeSend(targetId,
        `🎁 *Admin မှ Miner ပေးပါပြီ!*\n\n` +
        `⛏️ *Slot #${slotIndex}* သင့်အတွက် Activate ပြုလုပ်ပြီးပါပြီ\n` +
        `ယခု ၁၀ မိနစ်တိုင်း 1,000 ကျပ် Auto ရရှိနေပါမည်! 💰`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(msg.chat.id, `❌ ${res?.error || 'Error ဖြစ်သွားသည်'}`);
    }
  });

  // ── /giveminer [userId] [slot] ────────────────────────────
  bot.onText(/\/giveminer (\d+) ([123])/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId  = parseInt(match[1]);
    const slotIndex = parseInt(match[2]);

    const res = await backendPost('/api/admin/bot/giveminer', { userId: targetId, slotIndex });
    if (res?.success) {
      await safeSend(msg.chat.id,
        `✅ *Miner Slot #${slotIndex} ပေးပြီးပါပြီ*\n` +
        `👤 User: ${targetId}\n` +
        `⛏️ Slot #${slotIndex} Active ဖြစ်ပြီ!`,
        { parse_mode: 'Markdown' }
      );
      await safeSend(targetId,
        `🎁 *Admin မှ Miner ပေးပါပြီ!*\n\n` +
        `⛏️ *Slot #${slotIndex}* သင့်အတွက် Activate ပြုလုပ်ပြီးပါပြီ\n` +
        `ယခု ၁၀ မိနစ်တိုင်း 1,000 ကျပ် Auto ရရှိနေပါမည်! 💰`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(msg.chat.id, `❌ ${res?.error || 'Error ဖြစ်သွားသည်'}`);
    }
  });

  // ── /revokeminer [userId] [slot] ──────────────────────────
  bot.onText(/\/revokeminer (\d+) ([123])/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;
    const targetId  = parseInt(match[1]);
    const slotIndex = parseInt(match[2]);

    const res = await backendPost('/api/admin/bot/revokeminer', { userId: targetId, slotIndex });
    if (res?.success) {
      await safeSend(msg.chat.id,
        `✅ *Miner Slot #${slotIndex} ဖြုတ်ပြီးပါပြီ*\n👤 User: ${targetId}`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await safeSend(msg.chat.id, `❌ ${res?.error || 'Miner မတွေ့ပါ'}`);
    }
  });

  // ── Non-command messages (Support forward) ────────────────
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId || userId === ADMIN_ID) return;
    if (msg.text?.startsWith('/')) return;
    // my_chat_member etc non-message updates ကို skip
    if (!msg.text && !msg.photo && !msg.document) return;

    if (msg.text) {
      await safeSend(ADMIN_ID,
        `📩 *Support Message*\n\n` +
        `👤 *${msg.from.first_name || ''}* (${userId})\n` +
        `💬 ${msg.text}\n\n` +
        `_Reply: /reply ${userId} <message>_`,
        { parse_mode: 'Markdown' }
      );
      await safeSend(chatId, '✅ Admin ထံ ပို့ပြီးပါပြီ');
    }
  });

  // ── Polling Error Handler ─────────────────────────────────
  bot.on('polling_error', (err) => {
    const errMsg  = err.message || '';
    const errCode = err.code   || '';

    // [FIX #4] 403 Forbidden — User block ကြောင့် မဟုတ်ဘဲ token ပြဿနာ ဖြစ်ရင်
    // Polling မရပ်ဘဲ log ထုတ်ပြီး ဆက်
    if (errMsg.includes('403') || errMsg.includes('Forbidden')) {
      console.warn(`⚠️  [polling_error] 403 Forbidden — polling continues: ${errMsg}`);
      return;
    }

    if (errMsg.includes('404')) {
      console.error('❌ [polling_error] 404 — BOT_TOKEN မမှန်ပါ!');
      return;
    }

    if (errMsg.includes('409') || errCode === 'ETELEGRAM') {
      console.error(`⚠️  [polling_error] 409 Conflict — restarting: ${errMsg}`);
      restartBot('409_conflict');
      return;
    }

    if (
      errCode === 'ECONNRESET'   ||
      errCode === 'ETIMEDOUT'    ||
      errCode === 'ENOTFOUND'    ||
      errCode === 'ECONNREFUSED' ||
      errMsg.includes('network') ||
      errMsg.includes('timeout') ||
      errMsg.includes('EFATAL')
    ) {
      console.error(`⚠️  [polling_error] Network error [${errCode}]: ${errMsg} — restarting...`);
      restartBot(`network_error_${errCode}`);
      return;
    }

    console.error(`⚠️  [polling_error] Unknown [${errCode}]: ${errMsg} — restarting...`);
    restartBot(`unknown_error_${errCode}`);
  });

  console.log('✅ All handlers registered.');
}

// ============================================================
//  EXPRESS SERVER
// ============================================================
const app = express();
app.use(express.json({ limit: '20mb' }));

app.get('/',       (_req, res) => res.send('🤖 Kyaw Ngar Mining Bot Running!'));
app.get('/health', (_req, res) => res.send('OK'));
app.get('/status', (_req, res) => res.json({
  status: 'ok',
  polling: isPolling,
  restarting: isRestarting,
  restartAttempts,
  lastUpdateAgo: Math.round((Date.now() - lastUpdateTime) / 1000) + 's',
  ts: Date.now()
}));

// ── Backend → Admin: Miner purchase screenshot ────────────
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
      { text: '✅ Approve', callback_data: `miner_approve_${minerId}_${userId}_${slotIndex}` },
      { text: '❌ Reject',  callback_data: `miner_reject_${minerId}_${userId}_${slotIndex}` }
    ]]
  };

  try {
    const buf = Buffer.from(screenshotBase64, 'base64');
    await bot.sendPhoto(ADMIN_ID, buf, {
      caption,
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard
    });

    await safeSend(parseInt(userId),
      `⏳ *Miner ဝယ်ယူမှု လက်ခံပြီးပါပြီ!*\n\n` +
      `Screenshot ကို Admin ထံ တိုက်ရိုက်ပို့ပြီးပါပြီ\n` +
      `မကြာမီ Admin စစ်ဆေးပြီး Activate ပေးပါမည် 🙏`,
      { parse_mode: 'Markdown' }
    );

    res.json({ success: true });
  } catch (e) {
    console.error('send-miner-photo error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Backend → Admin: Withdrawal screenshot ────────────────
app.post('/send-withdrawal-photo', async (req, res) => {
  if (!bot || !isPolling) return res.status(503).json({ error: 'Bot not ready' });
  const { userId, firstName, withdrawalId, amount, method, accountNumber, accountName, screenshotBase64 } = req.body;
  if (!userId || !withdrawalId || !screenshotBase64) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const caption =
    `💸 *ငွေထုတ်တောင်းဆိုမှု — Fee Screenshot*\n\n` +
    `👤 *User:* ${firstName || userId}\n` +
    `🆔 *User ID:* \`${userId}\`\n` +
    `💰 *Amount:* ${Number(amount).toLocaleString()} ကျပ်\n` +
    `🏦 *Method:* ${method}\n` +
    `📱 *Account:* ${accountNumber}\n` +
    `👤 *Name:* ${accountName}\n` +
    `🛒 *WD ID:* \`${withdrawalId}\`\n\n` +
    `_Approve or Reject below ↓_`;

  const inlineKeyboard = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `wd_approve_${withdrawalId}_${userId}` },
      { text: '❌ Reject',  callback_data: `wd_reject_${withdrawalId}_${userId}` }
    ]]
  };

  try {
    const buf = Buffer.from(screenshotBase64, 'base64');
    await bot.sendPhoto(ADMIN_ID, buf, {
      caption, parse_mode: 'Markdown', reply_markup: inlineKeyboard
    });
    res.json({ success: true });
  } catch (e) {
    console.error('send-withdrawal-photo error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Generic user notification ─────────────────────────────
app.post('/notify-user', async (req, res) => {
  if (!bot || !isPolling) return res.status(503).json({ error: 'Bot not ready' });
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: 'Missing fields' });

  const result = await safeSend(parseInt(userId), message, { parse_mode: 'Markdown' });
  if (result) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to send (user may have blocked bot)' });
  }
});

app.use((err, _req, res, _next) => {
  console.error('Express error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initializeBot().then(() => {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║  ⛏️  Kyaw Ngar Mining Bot  —  Ready! (v2 Fixed) ║
╠══════════════════════════════════════════════════╣
║  Port: ${String(PORT).padEnd(42)}║
║  Admin: ${String(ADMIN_ID).padEnd(41)}║
║  ✅ Block/Unblock Fix    ✅ Watchdog Leak Fix    ║
║  ✅ MAX_RESTART Fix      ✅ Polling Death Fix    ║
║  ✅ my_chat_member Fix   ✅ safeSend Fix         ║
╚══════════════════════════════════════════════════╝`);
  });
}).catch(e => { console.error('Startup failed:', e); process.exit(1); });

process.once('SIGINT',  () => {
  if (watchdogTimer) clearInterval(watchdogTimer);
  if (bot) bot.stopPolling();
  process.exit(0);
});
process.once('SIGTERM', () => {
  if (watchdogTimer) clearInterval(watchdogTimer);
  if (bot) bot.stopPolling();
  process.exit(0);
});
