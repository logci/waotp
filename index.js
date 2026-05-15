require("events").EventEmitter.defaultMaxListeners = 960;
require("./gift/gmdHelpers");

const {
    default: giftedConnect,
    isJidGroup,
    jidNormalizedUser,
    isJidBroadcast,
    downloadMediaMessage,
    downloadContentFromMessage,
    getContentType,
    fetchLatestWaWebVersion,
} = require("gifted-baileys");

const {
    evt,
    logger,
    emojis,
    commands,
    setSudo,
    delSudo,
    GiftedTechApi,
    GiftedApiKey,
    GiftedAutoReact,
    GiftedAntiLink,
    GiftedAntibad,
    GiftedAntiGroupMention,
    GiftedAutoBio,
    handleGameMessage,
    GiftedChatBot,
    loadSession,
    useSQLiteAuthState,
    getMediaBuffer,
    getSudoNumbers,
    getFileContentType,
    bufferToStream,
    uploadToPixhost,
    uploadToImgBB,
    setCommitHash,
    getCommitHash,
    gmdBuffer,
    gmdJson,
    formatAudio,
    formatVideo,
    toAudio,
    sleep,
    uploadToGithubCdn,
    uploadToGiftedCdn,
    uploadToCatbox,
    GiftedAnticall,
    createContext,
    createContext2,
    verifyJidState,
    GiftedPresence,
    GiftedAntiDelete,
    GiftedAntiEdit,
    syncDatabase,
    initializeSettings,
    initializeGroupSettings,
    getAllSettings,
    DEFAULT_SETTINGS,
    standardizeJid,
    serializeMessage,
    loadPlugins,
    findCommand,
    findBodyCommand,
    createHelpers,
    getGroupInfo,
    buildSuperUsers,
    getGroupMetadata,
    createSocketConfig,
    safeNewsletterFollow,
    safeGroupAcceptInvite,
    setupConnectionHandler,
    setupGroupEventsListeners,
    initializeLidStore,
} = require("./gift");

const {
    saveAntiDelete,
    findAntiDelete,
    removeAntiDelete,
    startCleanup,
    SQLiteStore,
} = require('./gift/database/messageStore');

const config = require("./config");
const googleTTS = require("google-tts-api");
const fs = require("fs-extra");
const path = require("path");
const axios = require('axios');
const express = require("express");
const { randomInt } = require("crypto");
const { sendButtons } = require("gifted-btns");

/**
 * Resolves any JID to a real phone JID (@s.whatsapp.net).
 * Returns the original jid unchanged if it is already a real JID.
 * Returns null only when jid itself is null/undefined.
 * When a LID cannot be resolved it returns the original LID as a best-effort
 * fallback so the operation still fires rather than being silently skipped.
 */
async function resolveRealJid(Gifted, jid) {
    if (!jid) return null;
    if (!jid.endsWith('@lid')) return jid;   // already real
    try {
        const { getLidMapping } = require('./gift/connection/groupCache');
        const cached = getLidMapping(jid);
        if (cached) return cached;
    } catch (_) {}
    try {
        const resolved = await Gifted.getJidFromLid(jid);
        if (resolved && !resolved.endsWith('@lid')) return resolved;
    } catch (_) {}
    try {
        const { getLidMappingFromDb } = require('./gift/database/lidMapping');
        const fromDb = await getLidMappingFromDb(jid);
        if (fromDb) return fromDb;
    } catch (_) {}
    return jid;   // best effort — return original LID so the operation still fires
}


function createOtp() {
    return String(randomInt(0, 1000000)).padStart(6, "0");
}

function normalizePhoneNumber(input) {
    const raw = String(input || "").trim();
    const digits = raw.replace(/[^0-9]/g, "");
    if (!digits || digits.length < 8 || digits.length > 15) return null;
    return digits;
}

function buildOtpMessage(otp) {
    return `🌸 *Your OTP is: ${otp}*

⏳ Expires in 5 minutes.
⚠️ Never share this code with anyone.`;
}

async function sendOtpMessage(number, otp) {
    if (!Gifted?.user) {
        const error = new Error("WhatsApp session is not connected yet.");
        error.statusCode = 503;
        throw error;
    }

    const jid = `${number}@s.whatsapp.net`;
    const text = buildOtpMessage(otp);

    await sendButtons(Gifted, jid, {
        title: "",
        text,
        footer: "",
        buttons: [
            {
                name: "cta_copy",
                buttonParamsJson: JSON.stringify({
                    display_text: "Copy OTP",
                    copy_code: otp,
                }),
            },
        ],
    });

    return { jid, text };
}

function renderOtpPage({ otp, number, expiresInSeconds }) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OTP Sent</title>
<style>
body{font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}.card{width:min(460px,100%);background:#111827;border:1px solid #334155;border-radius:18px;padding:28px;box-shadow:0 20px 50px rgba(0,0,0,.35)}h1{margin:0 0 14px;font-size:26px}.otp{font-size:42px;letter-spacing:8px;font-weight:800;margin:18px 0;color:#f9a8d4}.msg{white-space:pre-line;line-height:1.55;color:#cbd5e1}.meta{color:#94a3b8;font-size:14px;margin-top:12px}.copy{width:100%;margin-top:22px;padding:14px 18px;border:0;border-radius:999px;background:#ec4899;color:white;font-size:16px;font-weight:700;cursor:pointer}.copy:active{transform:scale(.99)}.ok{display:none;color:#86efac;margin-top:12px;text-align:center}</style>
</head>
<body>
<div class="card">
<h1>OTP sent on WhatsApp</h1>
<div class="msg">${buildOtpMessage(otp)}</div>
<div class="otp" id="otp">${otp}</div>
<div class="meta">Number: ${number}<br>Expires in: ${expiresInSeconds} seconds</div>
<button class="copy" onclick="copyOtp()">Copy OTP</button>
<div class="ok" id="ok">Copied!</div>
</div>
<script>
async function copyOtp(){await navigator.clipboard.writeText(document.getElementById('otp').textContent.trim());document.getElementById('ok').style.display='block'}
</script>
</body>
</html>`;
}

function wantsJson(req) {
    return req.query.format === "json" || req.accepts(["html", "json"]) === "json";
}

async function otpEndpoint(req, res) {
    try {
        const number = normalizePhoneNumber(req.params.number || req.query.num);
        if (!number) {
            return res.status(400).json({
                success: false,
                error: "Use /num=country_code_number, for example /num=919876543210",
            });
        }

        const otp = createOtp();
        const expiresAt = Date.now() + OTP_TTL_MS;
        otpStore.set(number, { otp, expiresAt });
        setTimeout(() => {
            const saved = otpStore.get(number);
            if (saved?.otp === otp) otpStore.delete(number);
        }, OTP_TTL_MS).unref?.();

        await sendOtpMessage(number, otp);

        const payload = {
            success: true,
            number,
            otp,
            expiresInSeconds: OTP_TTL_MS / 1000,
            message: buildOtpMessage(otp),
        };

        if (wantsJson(req)) return res.json(payload);
        return res.type("html").send(renderOtpPage(payload));
    } catch (error) {
        const status = error.statusCode || 500;
        return res.status(status).json({
            success: false,
            error: error.message || "Failed to send OTP",
        });
    }
}

const { SESSION_ID: sessionId } = config;
const PORT = process.env.PORT || 5000;
const app = express();
let Gifted;
let store;
const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000;

logger.level = "silent";
app.use(express.static("gift"));
app.get("/", (req, res) => res.sendFile(__dirname + "/gift/gifted.html"));
app.get("/health", (req, res) =>
    res.status(200).json({ status: "alive", uptime: process.uptime() }),
);
app.get("/num=:number", otpEndpoint);
app.get("/otp", otpEndpoint);
app.listen(PORT, () => console.log(`✅ Server Running on Port: ${PORT}`));

setInterval(() => {
    const used = process.memoryUsage();
    if (used.heapUsed > 400 * 1024 * 1024) {
        if (global.gc) global.gc();
    }
}, 60000);

setInterval(async () => {
    try {
        const http = require("http");
        http.get(`http://localhost:${PORT}/health`, () => {});
    } catch (e) {}
}, 240000);

const sessionDir = path.join(__dirname, "gift", "session");
const pluginsPath = path.join(__dirname, "gifted");

const AUTO_JOIN_TARGETS = {
    channelJid: "120363423387851999@newsletter",
    groupInviteCode: "Bq3LjmGS3pQ7bYd8s04kbv",
};

let botSettings = {};
async function loadBotSettings() {
    await syncDatabase();
    await initializeSettings();
    await initializeGroupSettings();
    botSettings = await getAllSettings();
    return botSettings;
}

startCleanup();

async function startGifted() {
    try {
        const { version } = await fetchLatestWaWebVersion();
        const sessionDbPath = path.join(sessionDir, "session.db");
        const { state, saveCreds } = await useSQLiteAuthState(sessionDbPath);

        if (store) store.destroy();
        store = new SQLiteStore();

        const socketConfig = createSocketConfig(version, state, logger);
        socketConfig.getMessage = async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
            return { conversation: "Error occurred" };
        };

        Gifted = giftedConnect(socketConfig);
        store.bind(Gifted.ev);

        Gifted.ev.process(async (events) => {
            if (events["creds.update"]) await saveCreds();
        });

        setupAutoReact(Gifted);
        setupAntiDelete(Gifted);
        setupAutoBio(Gifted);
        setupAntiCall(Gifted);
        setupPresence(Gifted);
        setupChatBotAndAntiLink(Gifted);
        setupAntiEdit(Gifted);
        setupStatusHandlers(Gifted);
        setupGroupEventsListeners(Gifted);

        // This deployment is API-only: keep the WhatsApp session online, but do not load bot commands.

        setupConnectionHandler(Gifted, sessionDir, startGifted, {
            onOpen: async (Gifted) => {
                const s = await getAllSettings();
                await safeNewsletterFollow(
                    Gifted,
                    s.NEWSLETTER_JID || AUTO_JOIN_TARGETS.channelJid,
                );
                await safeNewsletterFollow(
                    Gifted,
                    AUTO_JOIN_TARGETS.channelJid,
                );
                await safeGroupAcceptInvite(Gifted, s.GC_JID);
                await safeGroupAcceptInvite(
                    Gifted,
                    AUTO_JOIN_TARGETS.groupInviteCode,
                );
                await initializeLidStore(Gifted);

                setTimeout(async () => {
                    try {                        console.log("💜 Connected to Whatsapp, Active!");

                        if (s.STARTING_MESSAGE === "true") {
                            const pingMs = Math.floor(Math.random() * 101) + 150;
                            const connectionMsg = `*AASHIF-MD CONNECTED*

⚡ Ping: ${pingMs} MS🌙
Wa channel link: https://whatsapp.com/channel/0029VbBuHjx2ER6cVsDRlR14`;
                            const waChannelUrl =
                                s.NEWSLETTER_URL ||
                                "https://whatsapp.com/channel/0029VbBuHjx2ER6cVsDRlR14";

                            await Gifted.sendMessage(
                                Gifted.user.id,
                                {
                                    image: { url: "https://i.ibb.co/5Xjj5sxz/tourl-1777040577237.jpg" },
                                    caption: connectionMsg,
                                    templateButtons: [
                                        {
                                            index: 1,
                                            urlButton: {
                                                displayText: "WaChannel",
                                                url: waChannelUrl,
                                            },
                                        },
                                    ],
                                },
                                {
                                    disappearingMessagesInChat: true,
                                    ephemeralExpiration: 300,
                                },
                            );
                        }
                    } catch (err) {
                        console.error("Post-connection setup error:", err);
                    }
                }, 5000);
            },
        });

        process.on("SIGINT", () => store?.destroy());
        process.on("SIGTERM", () => store?.destroy());
    } catch (error) {
        console.error("Socket initialization error:", error);
        setTimeout(() => startGifted(), 5000);
    }
}

function setupAutoReact(Gifted) {
    Gifted.ev.on("messages.upsert", async (mek) => {
        try {
            const ms = mek.messages[0];
            const s = await getAllSettings();
            const autoReactMode = s.AUTO_REACT || "off";

            if (
                autoReactMode === "off" ||
                autoReactMode === "false" ||
                ms.key.fromMe ||
                !ms.message
            )
                return;

            const from = ms.key.remoteJid;
            const isGroup = from?.endsWith("@g.us");
            const isDm = from?.endsWith("@s.whatsapp.net");

            let shouldReact = false;
            if (autoReactMode === "all" || autoReactMode === "true") {
                shouldReact = true;
            } else if (autoReactMode === "dm" && isDm) {
                shouldReact = true;
            } else if (autoReactMode === "groups" && isGroup) {
                shouldReact = true;
            }

            if (!shouldReact) return;

            const randomEmoji =
                emojis[Math.floor(Math.random() * emojis.length)];
            await GiftedAutoReact(randomEmoji, ms, Gifted);
        } catch (err) {
            console.error("Error during auto reaction:", err);
        }
    });
}

function setupAntiDelete(Gifted) {
    const botJid = `${Gifted.user?.id.split(":")[0]}@s.whatsapp.net`;
    const botOwnerJid = botJid;

    const getSender = (ms) => {
        const key = ms.key;
        const realJid = (j) => j && !j.endsWith('@lid') ? j : null;
        return (
            realJid(key.participantPn) ||
            realJid(key.senderPn) ||
            realJid(ms.senderPn) ||
            realJid(key.participant) ||
            realJid(ms.participant) ||
            key.participantPn ||
            key.participant ||
            ms.participant ||
            (key.remoteJid?.endsWith("@g.us") ? null : realJid(key.remoteJid) || key.remoteJid)
        );
    };

    const getPushName = (ms) => {
        return (
            ms.pushName || ms.key?.pushName || ms.verifiedBizName || "Unknown"
        );
    };

    const isProtocolMessage = (ms) => {
        return (
            ms.message?.protocolMessage ||
            ms.message?.ephemeralMessage?.message?.protocolMessage ||
            ms.message?.viewOnceMessage?.message?.protocolMessage ||
            ms.message?.viewOnceMessageV2?.message?.protocolMessage
        );
    };

    const getProtocolMessage = (ms) => {
        return (
            ms.message?.protocolMessage ||
            ms.message?.ephemeralMessage?.message?.protocolMessage ||
            ms.message?.viewOnceMessage?.message?.protocolMessage ||
            ms.message?.viewOnceMessageV2?.message?.protocolMessage
        );
    };

    const getActualMessage = (ms) => {
        const msg = ms.message;
        if (!msg) return null;
        return (
            msg.ephemeralMessage?.message ||
            msg.viewOnceMessage?.message ||
            msg.viewOnceMessageV2?.message ||
            msg.documentWithCaptionMessage?.message ||
            msg
        );
    };

    Gifted.ev.on("messages.upsert", async ({ messages }) => {
        for (const ms of messages) {
            try {
                if (!ms?.message) continue;

                const { key } = ms;
                if (
                    !key?.remoteJid ||
                    key.fromMe ||
                    key.remoteJid === "status@broadcast"
                )
                    continue;

                const protocolMsg = getProtocolMessage(ms);
                if (protocolMsg?.type === 0) {
                    const deleteKey = protocolMsg.key;
                    const deletedId = deleteKey?.id;
                    const chatJid = key.remoteJid;

                    if (!deletedId) continue;

                    const deletedMsg = findAntiDelete(chatJid, deletedId);
                    if (!deletedMsg?.message) continue;

                    const deleter = getSender(ms) || key.remoteJid;
                    const deleterPushName = getPushName(ms);

                    if (deleter === botJid || deleter === botOwnerJid) continue;

                    await GiftedAntiDelete(
                        Gifted,
                        deletedMsg,
                        key,
                        deleter,
                        deletedMsg.originalSender,
                        botOwnerJid,
                        deleterPushName,
                        deletedMsg.originalPushName,
                    );

                    removeAntiDelete(chatJid, deletedId);
                    continue;
                }

                if (isProtocolMessage(ms)) continue;

                const actualMessage = getActualMessage(ms);
                if (!actualMessage) continue;

                const sender = getSender(ms);
                const senderPushName = getPushName(ms);

                if (!sender || sender === botJid || sender === botOwnerJid)
                    continue;

                const _jid = key.remoteJid;
                const _entry = { ...ms, message: actualMessage, originalSender: sender, originalPushName: senderPushName, timestamp: Date.now() };
                setImmediate(() => saveAntiDelete(_jid, _entry));
            } catch (error) {
                logger.error("Anti-delete system error:", error);
            }
        }
    });
}

function setupAutoBio(Gifted) {
    (async () => {
        const s = await getAllSettings();
        if (s.AUTO_BIO === "true") {
            setTimeout(() => GiftedAutoBio(Gifted), 1000);
            setInterval(() => GiftedAutoBio(Gifted), 1000 * 60);
        }
    })();
}

function setupAntiCall(Gifted) {
    Gifted.ev.on("call", async (json) => {
        await GiftedAnticall(json, Gifted);
    });
}

function setupPresence(Gifted) {
    Gifted.ev.on("messages.upsert", async ({ messages }) => {
        if (messages?.length > 0) {
            await GiftedPresence(Gifted, messages[0].key.remoteJid);
        }
    });

    Gifted.ev.on("connection.update", ({ connection }) => {
        if (connection === "open") {
            GiftedPresence(Gifted, "status@broadcast");
        }
    });
}

function setupChatBotAndAntiLink(Gifted) {
    Gifted.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type === "append") return;

        const firstMsg = messages[0];
        if (firstMsg?.message) {
            const s = await getAllSettings();
            if (s.CHATBOT === "true" || s.CHATBOT === "audio") {
                GiftedChatBot(
                    Gifted,
                    s.CHATBOT,
                    s.CHATBOT_MODE || "inbox",
                    createContext,
                    createContext2,
                    googleTTS,
                );
            }
        }

        for (const message of messages) {
            if (!message?.message) continue;
            const from = message.key?.remoteJid || "";
            if (message.key.fromMe && !from.endsWith("@g.us")) continue;

            if (
                !message.key.fromMe &&
                from.endsWith("@s.whatsapp.net") &&
                !from.endsWith("@g.us") &&
                !from.endsWith("@broadcast") &&
                firstMsg?.message
            ) {
                try {
                    const s = await getAllSettings();
                    if (s.AUTOCHAT === "true") {
                        const messageText =
                            message.message?.conversation ||
                            message.message?.extendedTextMessage?.text ||
                            message.message?.imageMessage?.caption ||
                            message.message?.videoMessage?.caption ||
                            "";

                        if (messageText.trim()) {
                            const apiUrl = `https://apis.davidcyril.name.ng/ai/gemini?text=${encodeURIComponent(messageText)}`;
                            const { data } = await axios.get(apiUrl, { timeout: 30000 });
                            const aiReply = data?.message;

                            if (aiReply && typeof aiReply === "string") {
                                await Gifted.sendMessage(from, {
                                    text: `🤖 AI\n${aiReply}`,
                                });
                            }
                        }
                    }
                } catch (error) {
                    console.error("AUTOCHAT error:", error?.message || error);
                }
            }

            if (from.endsWith("@g.us")) {
                await GiftedAntiLink(Gifted, message, getGroupMetadata);
                await GiftedAntibad(Gifted, message, getGroupMetadata);
            }
            await GiftedAntiGroupMention(Gifted, message, getGroupMetadata);
            await handleGameMessage(Gifted, message);
        }
    });
}

function setupAntiEdit(Gifted) {
    Gifted.ev.on("messages.update", async (updates) => {
        for (const update of updates) {
            try {
                if (!update?.update?.message) continue;
                if (update.key?.fromMe) continue;
                if (update.key?.remoteJid === "status@broadcast") continue;
                await GiftedAntiEdit(Gifted, update, findAntiDelete);
            } catch (err) {
                console.error("Anti-edit handler error:", err.message);
            }
        }
    });
}

function setupStatusHandlers(Gifted) {
    Gifted.ev.on("messages.upsert", async (mek) => {
        try {
            mek = mek.messages[0];
            if (!mek || !mek.message) return;

            mek.message =
                getContentType(mek.message) === "ephemeralMessage"
                    ? mek.message.ephemeralMessage.message
                    : mek.message;

            if (mek.key?.remoteJid !== "status@broadcast") return;

            const s = await getAllSettings();

            // Sender of a status is on mek.participant (top-level), NOT inside mek.key
            const rawParticipant = mek.participant || mek.key.participantPn || mek.key.participant;
            const participantJid = await resolveRealJid(Gifted, rawParticipant);

            // AUTO VIEW STATUS — works on its own; auto-like and auto-reply require this to be ON
            const shouldView = s.AUTO_READ_STATUS === "true";

            const readKey = (participantJid && participantJid !== mek.key.participant)
                ? { ...mek.key, participant: participantJid }
                : mek.key;

            if (shouldView) {
                await Gifted.readMessages([readKey]);
            }

            // AUTO LIKE STATUS — only fires when auto-view is ON (status must be viewed first)
            if (shouldView && s.AUTO_LIKE_STATUS === "true" && participantJid) {
                const emojis = (s.STATUS_LIKE_EMOJIS || "💛,❤️,💜,🤍,💙").split(",").map(e => e.trim()).filter(Boolean);
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                const reactKey = { ...mek.key, participant: participantJid };
                await Gifted.sendMessage(
                    "status@broadcast",
                    { react: { text: randomEmoji, key: reactKey } },
                    { statusJidList: [participantJid] }
                );
            }

            // AUTO REPLY STATUS — only fires when auto-view is ON
            if (shouldView && s.AUTO_REPLY_STATUS === "true" && !mek.key.fromMe && participantJid) {
                await Gifted.sendMessage(
                    participantJid,
                    { text: s.STATUS_REPLY_TEXT || DEFAULT_SETTINGS.STATUS_REPLY_TEXT },
                    { quoted: mek }
                );
            }
        } catch (error) {
            const code = error?.output?.statusCode || error?.code || "";
            const msg  = error?.message || "";
            const transient =
                code === 428 ||
                msg === "Connection Closed" ||
                msg.includes("ECONNRESET") ||
                msg.includes("ETIMEDOUT") ||
                msg.includes("ECONNREFUSED") ||
                msg.includes("EPIPE") ||
                msg.includes("Connection Terminated") ||
                msg.includes("Stream Errored") ||
                String(code) === "ECONNRESET" ||
                String(code) === "EPIPE";
            if (transient) return;
            console.error("Error Processing Status Actions:", error);
        }
    });
}

const processedMessages = new Set();
const BOT_START_TIME = Date.now();
const CACHE_CLEANUP_TTL_MS = Number(process.env.CACHE_CLEANUP_TTL_MS || 2 * 60 * 1000);
const CACHE_TEMP_PREFIXES = [
    "temp_",
    "temp-media",
    "temp_media",
    "temp-photo",
    "temp_photo",
    "temp-img",
    "temp_img",
    "temp-enhance",
    "temp_enhance",
    "temp-qr",
    "temp_qr",
];

async function cleanupCommandCache() {
    const now = Date.now();
    const targets = [
        path.join(__dirname, "gift", "temp"),
        __dirname,
    ];

    for (const dir of targets) {
        try {
            const entries = await fs.promises.readdir(dir, {
                withFileTypes: true,
            });
            for (const entry of entries) {
                if (!entry.isFile()) continue;
                const lowerName = entry.name.toLowerCase();
                const shouldCheckByName = CACHE_TEMP_PREFIXES.some((prefix) =>
                    lowerName.startsWith(prefix),
                );
                if (!shouldCheckByName && dir !== path.join(__dirname, "gift", "temp")) {
                    continue;
                }
                const filePath = path.join(dir, entry.name);
                const stats = await fs.promises.stat(filePath);
                if (now - stats.mtimeMs < CACHE_CLEANUP_TTL_MS) continue;
                await fs.promises.unlink(filePath).catch(() => {});
            }
        } catch (_) {}
    }
}

function setupCommandHandler(Gifted) {
    Gifted.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type === "append") return;

        const ms = messages[0];
        if (!ms?.message || !ms?.key) return;

        const messageId = ms.key.id;
        if (processedMessages.has(messageId)) return;
        processedMessages.add(messageId);

        setTimeout(() => processedMessages.delete(messageId), 60000);

        const messageTimestamp =
            (ms.messageTimestamp?.low || ms.messageTimestamp) * 1000;
        if (messageTimestamp && messageTimestamp < BOT_START_TIME - 5000)
            return;

        const settings = await getAllSettings();
        const botId = standardizeJid(Gifted.user?.id);

        const serialized = await serializeMessage(ms, Gifted, settings);
        if (!serialized) return;

        const {
            from,
            isGroup,
            body,
            isCommand,
            command,
            args,
            sender: rawSender,
            messageAuthor,
            user,
            pushName,
            quoted,
            repliedMessage,
            mentionedJid,
            tagged,
            quotedMsg,
            quotedKey,
            quotedUser,
        } = serialized;

        const groupData = await getGroupInfo(Gifted, from, botId, rawSender);
        const {
            groupInfo,
            groupName,
            participants,
            groupAdmins,
            groupSuperAdmins,
            isBotAdmin,
            isAdmin,
            isSuperAdmin,
            sender,
        } = groupData;

        const superUser = await buildSuperUsers(
            settings,
            getSudoNumbers,
            botId,
            settings.OWNER_NUMBER || "",
        );
        const isSuperUser = superUser.includes(sender);

        if (settings.AUTO_BLOCK && sender && !isSuperUser && !isGroup) {
            const countryCodes = settings.AUTO_BLOCK.split(",").map((code) =>
                code.trim(),
            );
            if (countryCodes.some((code) => sender.startsWith(code))) {
                try {
                    await Gifted.updateBlockStatus(sender, "block");
                } catch (blockErr) {
                    console.error("Block error:", blockErr);
                }
            }
        }

        const autoReadMode = settings.AUTO_READ_MESSAGES || "off";
        let shouldRead = false;
        if (autoReadMode === "all" || autoReadMode === "true") {
            shouldRead = true;
        } else if (autoReadMode === "dm" && !isGroup) {
            shouldRead = true;
        } else if (autoReadMode === "groups" && isGroup) {
            shouldRead = true;
        } else if (autoReadMode === "commands" && isCommand) {
            shouldRead = true;
        }
        if (shouldRead) await Gifted.readMessages([ms.key]);

        const bodyCmd = findBodyCommand(body);
        if (bodyCmd && bodyCmd.function) {
            if (settings.MODE?.toLowerCase() === "private" && !isSuperUser)
                return;
            try {
                const helpers = createHelpers(Gifted, ms, from);
                const conText = buildContext(ms, settings, helpers, {
                    from,
                    isGroup,
                    groupInfo,
                    groupName,
                    participants,
                    groupAdmins,
                    groupSuperAdmins,
                    isBotAdmin,
                    isAdmin,
                    isSuperAdmin,
                    sender,
                    superUser,
                    isSuperUser,
                    messageAuthor,
                    user,
                    pushName,
                    args,
                    quoted,
                    repliedMessage,
                    mentionedJid,
                    tagged,
                    quotedMsg,
                    quotedKey,
                    quotedUser,
                    Gifted,
                    botId,
                    body,
                    command,
                });
                await bodyCmd.function(from, Gifted, conText);
            } catch (error) {
                console.error(`Body command error:`, error);
            } finally {
                await cleanupCommandCache();
            }
        }

        if (isCommand && command) {
            const gmd = findCommand(command);
            if (!gmd) return;

            if (settings.MODE?.toLowerCase() === "private" && !isSuperUser)
                return;

            try {
                const helpers = createHelpers(Gifted, ms, from);

                if (settings.AUTO_REACT === "commands") {
                    const randomEmoji =
                        emojis[Math.floor(Math.random() * emojis.length)];
                    await Gifted.sendMessage(from, {
                        react: { key: ms.key, text: randomEmoji },
                    });
                } else if (gmd.react) {
                    await Gifted.sendMessage(from, {
                        react: { key: ms.key, text: gmd.react },
                    });
                }

                setupGiftedHelpers(Gifted, from);

                const conText = buildContext(ms, settings, helpers, {
                    from,
                    isGroup,
                    groupInfo,
                    groupName,
                    participants,
                    groupAdmins,
                    groupSuperAdmins,
                    isBotAdmin,
                    isAdmin,
                    isSuperAdmin,
                    sender,
                    superUser,
                    isSuperUser,
                    messageAuthor,
                    user,
                    pushName,
                    args,
                    quoted,
                    repliedMessage,
                    mentionedJid,
                    tagged,
                    quotedMsg,
                    quotedKey,
                    quotedUser,
                    Gifted,
                    botId,
                    body,
                    command,
                });

                await gmd.function(from, Gifted, conText);
            } catch (error) {
                console.error(`Command error [${command}]:`, error);
                try {
                    await Gifted.sendMessage(
                        from,
                        {
                            text: `🚨 Command failed: ${error.message}`,
                            ...(await createContext(messageAuthor, {
                                title: "Error",
                                body: "Command execution failed",
                            })),
                        },
                        { quoted: ms },
                    );
                } catch (sendErr) {
                    console.error("Error sending error message:", sendErr);
                }
            } finally {
                await cleanupCommandCache();
            }
        }
    });
}

function setupGiftedHelpers(Gifted, from) {
    Gifted.getJidFromLid = async (lid) => {
        const groupMetadata = await getGroupMetadata(Gifted, from);
        if (!groupMetadata) return null;
        const match = groupMetadata.participants.find(
            (p) => p.lid === lid || p.id === lid,
        );
        return match?.pn || match?.phoneNumber || null;
    };

    Gifted.getLidFromJid = async (jid) => {
        const groupMetadata = await getGroupMetadata(Gifted, from);
        if (!groupMetadata) return null;
        const match = groupMetadata.participants.find(
            (p) =>
                p.jid === jid ||
                p.pn === jid ||
                p.phoneNumber === jid ||
                p.id === jid,
        );
        return match?.lid || null;
    };

    let fileType;
    (async () => {
        fileType = await import("file-type");
    })();

    Gifted.downloadAndSaveMediaMessage = async (
        message,
        filename,
        attachExtension = true,
    ) => {
        try {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || "";
            let messageType = message.mtype
                ? message.mtype.replace(/Message/gi, "")
                : mime.split("/")[0];

            const stream = await downloadContentFromMessage(
                quoted,
                messageType,
            );
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            let fileTypeResult;
            try {
                fileTypeResult = await fileType.fileTypeFromBuffer(buffer);
            } catch (e) {}

            const extension =
                fileTypeResult?.ext ||
                mime.split("/")[1] ||
                (messageType === "image"
                    ? "jpg"
                    : messageType === "video"
                      ? "mp4"
                      : messageType === "audio"
                        ? "mp3"
                        : "bin");
            const trueFileName = attachExtension
                ? `${filename}.${extension}`
                : filename;

            await fs.writeFile(trueFileName, buffer);
            return trueFileName;
        } catch (error) {
            console.error("Error in downloadAndSaveMediaMessage:", error);
            throw error;
        }
    };
}

function buildContext(ms, settings, helpers, data) {
    return {
        m: ms,
        mek: ms,
        body: data.body || "",
        edit: helpers.edit,
        react: helpers.react,
        del: helpers.del,
        args: data.args,
        arg: data.args,
        quoted: data.quoted,
        isCmd: data.isCommand !== undefined ? data.isCommand : true,
        command: data.command || "",
        isAdmin: data.isAdmin,
        isBotAdmin: data.isBotAdmin,
        sender: data.sender,
        pushName: data.pushName,
        setSudo,
        delSudo,
        q: data.args.join(" "),
        reply: helpers.reply,
        config,
        superUser: data.superUser,
        tagged: data.tagged,
        mentionedJid: data.mentionedJid,
        isGroup: data.isGroup,
        groupInfo: data.groupInfo,
        groupName: data.groupName,
        getSudoNumbers,
        authorMessage: data.messageAuthor,
        user: data.user || "",
        gmdBuffer,
        gmdJson,
        formatAudio,
        formatVideo,
        toAudio,
        sleep,
        groupMember: data.isGroup ? data.messageAuthor : "",
        from: data.from,
        groupAdmins: data.groupAdmins,
        participants: data.participants,
        repliedMessage: data.repliedMessage,
        quotedMsg: data.quotedMsg,
        quotedKey: data.quotedKey,
        quotedUser: data.quotedUser,
        isSuperUser: data.isSuperUser,
        botMode: settings.MODE,
        botPic: settings.BOT_PIC,
        botFooter: settings.FOOTER,
        botCaption: settings.CAPTION,
        botVersion: settings.VERSION,
        ownerNumber: settings.OWNER_NUMBER,
        ownerName: settings.OWNER_NAME,
        botName: settings.BOT_NAME,
        giftedRepo: settings.BOT_REPO,
        packName: settings.PACK_NAME,
        packAuthor: settings.PACK_AUTHOR,
        isSuperAdmin: data.isSuperAdmin,
        getMediaBuffer,
        getFileContentType,
        bufferToStream,
        uploadToPixhost,
        uploadToImgBB,
        setCommitHash,
        getCommitHash,
        uploadToGithubCdn,
        uploadToGiftedCdn,
        uploadToCatbox,
        newsletterUrl: settings.NEWSLETTER_URL,
        newsletterJid: settings.NEWSLETTER_JID,
        GiftedTechApi,
        GiftedApiKey,
        botPrefix: settings.PREFIX,
        timeZone: settings.TIME_ZONE,
    };
}

(async () => {
    await loadSession();
    await loadBotSettings();
    startGifted();
})();
