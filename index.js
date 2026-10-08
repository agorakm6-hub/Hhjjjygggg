// ============================================================
//  index.js — бот "What's My IP"
//  /start → пользовательское соглашение → кнопка «Принимаю»
//  → сообщение с кнопкой мини-приложения «Узнать свой IP».
//  Мини-приложение (index.html) лежит рядом с этим файлом и отдаётся этим же сервером.
//  Хостинг: Render (webhook + анти-слип).
// ============================================================
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ====== КОНФИГ ======
const BOT_TOKEN = process.env.BOT_TOKEN || '';
if (!BOT_TOKEN) { console.error('❌ Не задан BOT_TOKEN.'); process.exit(1); }

const PORT = process.env.PORT || 10000;
const EXTERNAL_URL = (process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL || '').replace(/\/$/, '');
if (!EXTERNAL_URL) { console.error('❌ Не найден RENDER_EXTERNAL_URL или WEBHOOK_URL.'); process.exit(1); }
const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(24).toString('hex');
const MINIAPP_URL = `${EXTERNAL_URL}/`;

// Где помним, кто принял соглашение.
// ВНИМАНИЕ: на бесплатном Render файловая система сбрасывается при перезапуске/деплое.
// Чтобы принятия сохранялись — подключи Render Disk и укажи DATA_DIR на его папку.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ACCEPT_FILE = path.join(DATA_DIR, 'accepted.json');

// ====== ТЕКСТЫ ======
const AGREEMENT_TEXT =
    '📄 <b>Пользовательское соглашение</b>\n' +
    '<b>What\'s My IP</b>\n\n' +
    '<b>1. Назначение.</b> Бот и мини-приложение показывают <u>ваш собственный</u> IP-адрес и открытые данные о нём (страна, регион, город, часовой пояс, провайдер) — исключительно в познавательных целях.\n\n' +
    '<b>2. Как это работает.</b> Когда вы открываете мини-приложение, наш сервер определяет IP-адрес, с которого вы подключились, и передаёт его сервису геолокации (ipwho.is), чтобы получить открытые данные об этом адресе.\n\n' +
    '<b>3. Что мы храним.</b> Только ваш Telegram ID — чтобы запомнить, что вы приняли соглашение. IP-адрес и результаты проверки не сохраняются.\n\n' +
    '<b>4. Точность.</b> Данные определяются по открытым базам и носят приблизительный характер: город и провайдер могут не совпадать с реальными. При использовании VPN или прокси будут показаны данные VPN или прокси.\n\n' +
    '<b>5. Только ваш IP.</b> Сервис показывает данные только того устройства, с которого открыто мини-приложение. Проверить чужой адрес нельзя, использовать сервис для слежки или иных незаконных целей запрещено.\n\n' +
    '<b>6. Ответственность.</b> Сервис предоставляется «как есть», без гарантий точности и бесперебойной работы.\n\n' +
    'Нажимая «Принимаю соглашение», вы подтверждаете, что прочитали условия и согласны с ними.';

const MAIN_TEXT =
    '🌍 <b>What\'s My IP</b>\n\n' +
    'Чтобы узнать свой IP-адрес и открытые данные о нём, откройте наше мини-приложение 👇';

const AGREEMENT_KEYBOARD = {
    inline_keyboard: [[{ text: '✅ Принимаю соглашение', callback_data: 'accept', style: 'success' }]],
};
// Цвет кнопки: "success" — зелёная (Bot API 9.4+)
const MAIN_KEYBOARD = {
    inline_keyboard: [[{ text: '🌍 Узнать свой IP', web_app: { url: MINIAPP_URL }, style: 'success' }]],
};

// ====== ХРАНИЛИЩЕ ПРИНЯТЫХ СОГЛАШЕНИЙ ======
let accepted = new Set();
try {
    accepted = new Set(JSON.parse(fs.readFileSync(ACCEPT_FILE, 'utf8')).map(String));
    console.log(`✅ Принявших соглашение: ${accepted.size}`);
} catch (e) { /* файла ещё нет — это нормально */ }

function saveAccepted() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = `${ACCEPT_FILE}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify([...accepted]));
        fs.renameSync(tmp, ACCEPT_FILE);
    } catch (e) { console.error('❌ Не удалось сохранить accepted.json:', e.message); }
}

// ====== БОТ ======
const bot = new TelegramBot(BOT_TOKEN, { webHook: false });
console.log('🚀 What\'s My IP бот запущен (webhook)');

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

async function sendMain(chatId, userId) {
    if (accepted.has(String(userId))) {
        await bot.sendMessage(chatId, MAIN_TEXT, { parse_mode: 'HTML', reply_markup: MAIN_KEYBOARD });
    } else {
        await bot.sendMessage(chatId, AGREEMENT_TEXT, { parse_mode: 'HTML', reply_markup: AGREEMENT_KEYBOARD, disable_web_page_preview: true });
    }
}

bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private' || !msg.from || msg.from.is_bot) return;
    try { await sendMain(msg.chat.id, msg.from.id); }
    catch (e) { console.error('message error:', e.message); }
});

bot.on('callback_query', async (q) => {
    try {
        if (q.data !== 'accept' || !q.message) { await bot.answerCallbackQuery(q.id); return; }
        accepted.add(String(q.from.id));
        saveAccepted();
        await bot.answerCallbackQuery(q.id, { text: 'Соглашение принято ✅' });
        try {
            await bot.editMessageText(MAIN_TEXT, {
                chat_id: q.message.chat.id,
                message_id: q.message.message_id,
                parse_mode: 'HTML',
                reply_markup: MAIN_KEYBOARD,
            });
        } catch (e) {
            await bot.sendMessage(q.message.chat.id, MAIN_TEXT, { parse_mode: 'HTML', reply_markup: MAIN_KEYBOARD });
        }
    } catch (e) { console.error('callback error:', e.message); }
});

// ====== ПРОВЕРКА ПОДПИСИ МИНИ-ПРИЛОЖЕНИЯ (initData) ======
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData) {
    if (typeof initData !== 'string' || !initData || initData.length > 4096) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    const a = Buffer.from(calc, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (!authDate || Date.now() / 1000 - authDate > 24 * 3600) return null;
    try {
        const user = JSON.parse(params.get('user') || '');
        return user && user.id ? user : null;
    } catch (e) { return null; }
}

// ====== ОПРЕДЕЛЕНИЕ IP И ГЕОДАННЫХ ======
function getClientIp(req) {
    let ip = req.headers['cf-connecting-ip']
        || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket.remoteAddress
        || '';
    ip = ip.replace(/^::ffff:/i, '');
    return ip;
}

function flagEmoji(code) {
    if (!code || code.length !== 2) return '';
    return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

async function lookupIp(ip) {
    // 1) ipwho.is (HTTPS, без ключа)
    try {
        const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?lang=ru`, { signal: AbortSignal.timeout(8000) });
        const d = await r.json();
        if (d && d.success) {
            return {
                country: d.country || null,
                countryCode: d.country_code || null,
                region: d.region || null,
                city: d.city || null,
                timezone: (d.timezone && d.timezone.id) || null,
                isp: (d.connection && (d.connection.isp || d.connection.org)) || null,
                asn: d.connection && d.connection.asn ? `AS${d.connection.asn}` : null,
                lat: typeof d.latitude === 'number' ? d.latitude : null,
                lon: typeof d.longitude === 'number' ? d.longitude : null,
            };
        }
    } catch (e) { console.warn('ipwho.is error:', e.message); }
    // 2) запасной вариант: ip-api.com (на бесплатном плане только HTTP — запрос идёт с сервера)
    try {
        const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,lat,lon,timezone,isp,as&lang=ru`, { signal: AbortSignal.timeout(8000) });
        const d = await r.json();
        if (d && d.status === 'success') {
            return {
                country: d.country || null,
                countryCode: d.countryCode || null,
                region: d.regionName || null,
                city: d.city || null,
                timezone: d.timezone || null,
                isp: d.isp || null,
                asn: d.as ? d.as.split(' ')[0] : null,
                lat: typeof d.lat === 'number' ? d.lat : null,
                lon: typeof d.lon === 'number' ? d.lon : null,
            };
        }
    } catch (e) { console.warn('ip-api error:', e.message); }
    return null;
}

const apiCooldown = new Map(); // userId -> timestamp
function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (c) => {
            body += c;
            if (body.length > limit) { reject(new Error('too big')); req.destroy(); }
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

async function handleApiIp(req, res) {
    let initData = '';
    try { initData = JSON.parse(await readBody(req, 16 * 1024)).initData; } catch (e) { /* пустой initData → 401 */ }
    const user = verifyInitData(initData);
    if (!user) return sendJson(res, 401, { error: 'auth' });
    if (!accepted.has(String(user.id))) return sendJson(res, 403, { error: 'consent' });

    const last = apiCooldown.get(String(user.id)) || 0;
    if (Date.now() - last < 2000) return sendJson(res, 429, { error: 'rate' });
    apiCooldown.set(String(user.id), Date.now());

    const ip = getClientIp(req);
    const version = net.isIP(ip);
    if (!version) return sendJson(res, 200, { ip: null, error: 'ip' });

    // Ничего не сохраняем: IP живёт только внутри этого запроса.
    const geo = await lookupIp(ip);
    sendJson(res, 200, {
        ip,
        type: version === 6 ? 'IPv6' : 'IPv4',
        flag: geo ? flagEmoji(geo.countryCode) : '',
        geoFailed: !geo,
        ...(geo || {}),
    });
}

// ====== HTTP-СЕРВЕР ======
// index.html лежит в одной папке с index.js
let indexHtml = '';
try { indexHtml = fs.readFileSync(path.join(__dirname, 'index.html')); }
catch (e) { console.error('❌ Не найден index.html'); }

const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

const server = http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];

    if (req.method === 'POST' && url === WEBHOOK_PATH) {
        if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
            console.warn('⚠️ Webhook: неверный или отсутствующий secret token — запрос отклонён');
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end('{"ok":false}');
            req.destroy();
            return;
        }
        let body = '';
        let tooBig = false;
        req.on('data', (c) => {
            if (tooBig) return;
            body += c;
            if (body.length > MAX_WEBHOOK_BODY_BYTES) {
                tooBig = true;
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end('{"ok":false}');
                req.destroy();
            }
        });
        req.on('end', () => {
            if (tooBig) return;
            try { bot.processUpdate(JSON.parse(body)); } catch (e) { console.error('parse error:', e); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        });
        return;
    }

    if (req.method === 'POST' && url === '/api/ip') {
        try { await handleApiIp(req, res); }
        catch (e) { console.error('api error:', e.message); if (!res.headersSent) sendJson(res, 500, { error: 'server' }); }
        return;
    }

    if (req.method === 'GET' && url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', bot: 'running', uptime: process.uptime() }));
        return;
    }

    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(indexHtml);
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
});

server.listen(PORT, async () => {
    console.log(`✅ Сервер на порту ${PORT}`);
    try {
        await bot.setWebHook(`${EXTERNAL_URL}${WEBHOOK_PATH}`, { secret_token: WEBHOOK_SECRET });
        console.log('✅ Webhook установлен');
    } catch (e) { console.error('❌ Webhook error:', e); }
    try {
        await bot.setMyCommands([{ command: 'start', description: 'Узнать свой IP' }]);
    } catch (e) { console.error('❌ setMyCommands error:', e); }
    keepAliveLoop();
    heartbeatLoop();
});

// ====== АНТИ-СЛИП ======
async function keepAliveLoop() {
    const url = `${EXTERNAL_URL}/health`;
    await new Promise((r) => setTimeout(r, 10000));
    while (true) {
        let success = false;
        for (let attempt = 1; attempt <= 3 && !success; attempt++) {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
                console.log(`🔄 Keep-alive пинг: ${res.status}`);
                success = true;
            } catch (e) {
                console.warn(`⚠️ Keep-alive пинг не удался (попытка ${attempt}/3): ${e.message}`);
                await new Promise((r) => setTimeout(r, 5000));
            }
        }
        if (!success) console.error('❌ Keep-alive: все попытки пинга провалились в этом цикле');
        await new Promise((r) => setTimeout(r, 150000));
    }
}

function heartbeatLoop() {
    setInterval(() => {
        try {
            const mod = EXTERNAL_URL.startsWith('https') ? https : http;
            const req = mod.get(`${EXTERNAL_URL}/health`, { timeout: 10000 }, (res) => {
                console.log(`💓 Heartbeat пинг: ${res.statusCode}`);
                res.resume();
            });
            req.on('timeout', () => req.destroy());
            req.on('error', (e) => console.warn(`⚠️ Heartbeat пинг не удался: ${e.message}`));
        } catch (e) {
            console.warn(`⚠️ Heartbeat ошибка: ${e.message}`);
        }
    }, 240000);
}
