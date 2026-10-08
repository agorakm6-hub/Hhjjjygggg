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

async function fetchJson(url, name) {
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'whats-my-ip-bot/1.0', 'Accept': 'application/json' } });
        if (!r.ok) { console.warn(`geo[${name}] HTTP ${r.status}`); return null; }
        return await r.json();
    } catch (e) { console.warn(`geo[${name}] ошибка: ${e.message}`); return null; }
}

const num = (v) => (typeof v === 'number' ? v : (v !== undefined && v !== null && v !== '' && !isNaN(Number(v)) ? Number(v) : null));

// Провайдеры геоданных по очереди — берём первый, который ответил нормально.
const GEO_PROVIDERS = [
    {
        name: 'ipwho.is',
        url: (ip) => `https://ipwho.is/${encodeURIComponent(ip)}?lang=ru`,
        parse: (d) => d && d.success ? {
            country: d.country, countryCode: d.country_code, region: d.region, city: d.city,
            timezone: d.timezone && d.timezone.id,
            isp: d.connection && (d.connection.isp || d.connection.org),
            asn: d.connection && d.connection.asn ? `AS${d.connection.asn}` : null,
            lat: num(d.latitude), lon: num(d.longitude),
        } : (d && console.warn(`geo[ipwho.is] отказ: ${d.message || 'unknown'}`), null),
    },
    {
        name: 'ipapi.co',
        url: (ip) => `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
        parse: (d) => d && !d.error ? {
            country: d.country_name, countryCode: d.country_code, region: d.region, city: d.city,
            timezone: d.timezone, isp: d.org, asn: d.asn, lat: num(d.latitude), lon: num(d.longitude),
        } : (d && console.warn(`geo[ipapi.co] отказ: ${d.reason || d.error}`), null),
    },
    {
        name: 'ip-api.com',
        url: (ip) => `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city,lat,lon,timezone,isp,as&lang=ru`,
        parse: (d) => d && d.status === 'success' ? {
            country: d.country, countryCode: d.countryCode, region: d.regionName, city: d.city,
            timezone: d.timezone, isp: d.isp, asn: d.as ? d.as.split(' ')[0] : null,
            lat: num(d.lat), lon: num(d.lon),
        } : (d && console.warn(`geo[ip-api.com] отказ: ${d.message || d.status}`), null),
    },
    {
        name: 'geojs.io',
        url: (ip) => `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`,
        parse: (d) => d && d.country_code ? {
            country: d.country, countryCode: d.country_code, region: d.region, city: d.city,
            timezone: d.timezone, isp: d.organization_name, asn: d.asn ? `AS${d.asn}` : null,
            lat: num(d.latitude), lon: num(d.longitude),
        } : null,
    },
    {
        name: 'freeipapi.com',
        url: (ip) => `https://freeipapi.com/api/json/${encodeURIComponent(ip)}`,
        parse: (d) => d && d.countryCode ? {
            country: d.countryName, countryCode: d.countryCode, region: d.regionName, city: d.cityName,
            timezone: d.timeZone || (d.timeZones && d.timeZones[0]), isp: null, asn: null,
            lat: num(d.latitude), lon: num(d.longitude),
        } : null,
    },
];

async function lookupIp(ip, req) {
    for (const p of GEO_PROVIDERS) {
        const d = await fetchJson(p.url(ip), p.name);
        let geo = null;
        try { geo = p.parse(d); } catch (e) { console.warn(`geo[${p.name}] parse: ${e.message}`); }
        if (geo && (geo.country || geo.city)) {
            console.log(`geo: ок через ${p.name}`);
            return {
                country: geo.country || null, countryCode: geo.countryCode || null,
                region: geo.region || null, city: geo.city || null,
                timezone: geo.timezone || null, isp: geo.isp || null, asn: geo.asn || null,
                lat: geo.lat, lon: geo.lon,
            };
        }
    }
    // Последний шанс: Render стоит за Cloudflare и сам сообщает страну в заголовке
    const cc = req && req.headers['cf-ipcountry'];
    if (cc && /^[A-Za-z]{2}$/.test(cc) && !['XX', 'T1'].includes(cc.toUpperCase())) {
        let name = null;
        try { name = new Intl.DisplayNames(['ru'], { type: 'region' }).of(cc.toUpperCase()); } catch (e) {}
        console.log('geo: только страна из заголовка Cloudflare');
        return { country: name || cc.toUpperCase(), countryCode: cc.toUpperCase(), region: null, city: null, timezone: null, isp: null, asn: null, lat: null, lon: null };
    }
    console.error('geo: все провайдеры не ответили');
    return null;
}

// ====== ПРОВЕРКА НА VPN / ПРОКСИ ======
// 1) флаги proxy/hosting от ip-api.com; 2) подозрительные названия провайдера.
const VPN_WORDS = /vpn|proxy|tunnel|hosting|datacenter|data center|cloud|server|colo|m247|datacamp|choopa|vultr|linode|digitalocean|hetzner|ovh|leaseweb|contabo|amazon|aws|google llc|microsoft|azure|oracle|cloudflare|warp|mullvad|nord|proton|surfshark|expressvpn|windscribe|tor |privacy|anonym|packethub|quadranet|frantech|ipvanish|cyberghost|hide\.me|tefincom|zenlayer|stark industries/i;

async function checkProxy(ip) {
    try {
        const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,proxy,hosting`, { signal: AbortSignal.timeout(4000) });
        const d = await r.json();
        if (d && d.status === 'success') return !!(d.proxy || d.hosting);
    } catch (e) { console.warn('vpn-check error:', e.message); }
    return null; // не удалось проверить
}

function ispLooksLikeVpn(geo) {
    return !!(geo && geo.isp && VPN_WORDS.test(geo.isp));
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
    const [geo, proxyFlag] = await Promise.all([lookupIp(ip, req), checkProxy(ip)]);
    sendJson(res, 200, {
        ip,
        type: version === 6 ? 'IPv6' : 'IPv4',
        flag: geo ? flagEmoji(geo.countryCode) : '',
        geoFailed: !geo,
        vpn: proxyFlag === true || ispLooksLikeVpn(geo),
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
