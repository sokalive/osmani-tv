const { Pool } = require("pg");
const express = require("express");
const createPaymentsRouter = require("./routes/payments");
const cors = require("cors");

const app = express();
app.use(express.json());

// ======================
// CORS (web preflight)
// ======================
// Expo web runs in a browser, so we must explicitly allow the deployed web origin.
// Mobile apps are not subject to CORS, but we keep `origin` checks permissive for non-browser calls.
const allowedOrigins = [
  "https://osmani-tv-web.onrender.com",
  // Common Expo dev origins (keep for local testing)
  "http://localhost:19006",
  "http://127.0.0.1:19006",
  "http://localhost:19000",
  "http://127.0.0.1:19000",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests without an Origin header (e.g. mobile apps, curl).
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

const PORT = process.env.PORT || 10000;
const DEFAULT_PROXY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// DEBUG
console.log("DATABASE_URL:", process.env.DATABASE_URL);

// ======================
// DATABASE CONNECTION
// ======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

// ======================
// ROUTES
// ======================

// ROOT TEST
app.get("/", (req, res) => {
  res.send("Server yako inafanya kazi 🚀");
});

// API TEST
app.get("/api", (req, res) => {
  res.json({ message: "API inafanya kazi 🔥" });
});

function applyProxyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
  res.setHeader("Access-Control-Expose-Headers", "Content-Type, Content-Length");
}

function safeParseUrl(value) {
  try {
    const u = new URL(String(value ?? "").trim());
    if (u.protocol === "http:" || u.protocol === "https:") return u;
    return null;
  } catch {
    return null;
  }
}

function detectHtmlBlock(text) {
  const s = String(text ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("sorry, you have been blocked") || s.includes("cloudflare")) return "cloudflare-block";
  if (s.includes("attention required") || s.includes("just a moment")) return "anti-bot-page";
  if (s.includes("forbidden") || s.includes("hotlink") || s.includes("referer")) return "anti-hotlink-page";
  if (s.includes("expired") || s.includes("token")) return "expired-token";
  if (s.includes("login") || s.includes("sign in") || s.includes("session")) return "login-session-gate";
  return "html-unexpected";
}

function buildProxyUrl(req, absoluteTarget, upstreamHeaders) {
  const next = new URL(`${req.protocol}://${req.get("host")}/api/stream-proxy`);
  next.searchParams.set("url", absoluteTarget);
  if (upstreamHeaders.referer) next.searchParams.set("referer", upstreamHeaders.referer);
  if (upstreamHeaders.origin) next.searchParams.set("origin", upstreamHeaders.origin);
  if (upstreamHeaders.userAgent) next.searchParams.set("ua", upstreamHeaders.userAgent);
  return next.toString();
}

function rewriteAttributeUris(line, baseUrl, req, upstreamHeaders) {
  return String(line).replace(/URI="([^"]+)"/g, (_m, rawUri) => {
    try {
      const absolute = new URL(rawUri, baseUrl).toString();
      return `URI="${buildProxyUrl(req, absolute, upstreamHeaders)}"`;
    } catch {
      return `URI="${rawUri}"`;
    }
  });
}

function rewriteManifestText(text, baseUrl, req, upstreamHeaders) {
  const lines = String(text ?? "").split("\n");
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      if (trimmed.includes('URI="')) {
        return rewriteAttributeUris(line, baseUrl, req, upstreamHeaders);
      }
      return line;
    }
    try {
      const absolute = new URL(trimmed, baseUrl).toString();
      return buildProxyUrl(req, absolute, upstreamHeaders);
    } catch {
      return line;
    }
  });
  return rewritten.join("\n");
}

app.options("/api/stream-proxy", (req, res) => {
  applyProxyCors(res);
  return res.sendStatus(204);
});

app.get("/api/stream-proxy", async (req, res) => {
  applyProxyCors(res);
  const sourceUrl = safeParseUrl(req.query.url);
  if (!sourceUrl) {
    return res.status(400).json({ error: "Missing or invalid url query parameter" });
  }

  const upstreamHeaders = {
    referer: String(req.query.referer ?? "").trim(),
    origin: String(req.query.origin ?? "").trim(),
    userAgent: String(req.query.ua ?? "").trim(),
  };

  const requestHeaders = {
    Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,video/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": upstreamHeaders.userAgent || DEFAULT_PROXY_UA,
    Connection: "keep-alive",
  };
  if (safeParseUrl(upstreamHeaders.referer)) requestHeaders.Referer = upstreamHeaders.referer;
  if (safeParseUrl(upstreamHeaders.origin)) requestHeaders.Origin = upstreamHeaders.origin;

  try {
    const upstreamRes = await fetch(sourceUrl.toString(), {
      method: "GET",
      redirect: "follow",
      headers: requestHeaders,
    });
    const finalUrl = upstreamRes.url || sourceUrl.toString();
    const contentType = String(upstreamRes.headers.get("content-type") || "").toLowerCase();

    console.log("[stream-proxy] upstream", {
      source: sourceUrl.toString(),
      finalUrl,
      status: upstreamRes.status,
      contentType,
      referer: requestHeaders.Referer || null,
      origin: requestHeaders.Origin || null,
      userAgent: requestHeaders["User-Agent"] || null,
    });

    if (!upstreamRes.ok) {
      const bodyText = await upstreamRes.text().catch(() => "");
      const classification = /text\/html/i.test(contentType) ? detectHtmlBlock(bodyText) : null;
      console.log("[stream-proxy] upstream-failure", {
        status: upstreamRes.status,
        finalUrl,
        classification,
        sample: String(bodyText).slice(0, 300),
      });
      return res.status(upstreamRes.status).json({
        error: "Upstream request failed",
        status: upstreamRes.status,
        final_url: finalUrl,
        classification,
      });
    }

    const finalBase = safeParseUrl(finalUrl)?.toString() || finalUrl;
    const isManifest =
      /\.m3u8(?:$|\?)/i.test(finalUrl) ||
      /application\/vnd\.apple\.mpegurl|application\/x-mpegurl|audio\/mpegurl/i.test(contentType);

    if (isManifest) {
      const manifestText = await upstreamRes.text();
      if (!/#EXTM3U/i.test(manifestText)) {
        const classification = detectHtmlBlock(manifestText);
        console.log("[stream-proxy] manifest-invalid", {
          finalUrl,
          classification,
          sample: String(manifestText).slice(0, 300),
        });
        return res.status(502).json({
          error: "Upstream did not return a valid manifest",
          final_url: finalUrl,
          classification,
        });
      }
      const rewritten = rewriteManifestText(manifestText, finalBase, req, upstreamHeaders);
      console.log("[stream-proxy] manifest-rewrite", {
        finalUrl,
        rewrittenLength: rewritten.length,
      });
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      return res.status(200).send(rewritten);
    }

    const bodyArrayBuffer = await upstreamRes.arrayBuffer();
    const outBuffer = Buffer.from(bodyArrayBuffer);
    if (contentType) res.setHeader("Content-Type", contentType);
    const contentLength = upstreamRes.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    console.log("[stream-proxy] media-pass", {
      finalUrl,
      status: upstreamRes.status,
      bytes: outBuffer.length,
      contentType,
    });
    return res.status(200).send(outBuffer);
  } catch (err) {
    console.error("[stream-proxy] proxy-error", {
      source: sourceUrl.toString(),
      error: String(err),
    });
    return res.status(500).json({ error: "Proxy request failed", details: String(err) });
  }
});

// ======================
// PAYMENTS (mounted at /api/payments/* — matches mobile app)
// ======================
app.use("/api/payments", createPaymentsRouter(pool));

// Payment status for client polling (maps DB row → SUCCESS | PENDING | FAILED)
app.get("/api/payment-status/:orderId", async (req, res) => {
  const orderId = String(req.params.orderId ?? "").trim();
  if (!orderId) {
    return res.status(400).json({ status: "FAILED", error: "Missing order id" });
  }
  try {
    const result = await pool.query(
      "SELECT status, zenopay_response FROM payment_transactions WHERE order_id = $1",
      [orderId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "FAILED",
        reason: "Order not found",
      });
    }
    const raw = String(result.rows[0].status || "").toUpperCase();
    const zp = result.rows[0].zenopay_response;
    const reasonFromJson =
      zp && typeof zp === "object"
        ? String(zp.body?.message ?? zp.body?.error ?? zp.message ?? "").trim()
        : "";

    const successSet = new Set([
      "COMPLETED",
      "COMPLETE",
      "SUCCESS",
      "PAID",
      "SUCCEEDED",
      "PAID_OUT",
    ]);
    const failedSet = new Set([
      "FAILED",
      "ZENOPAY_ERROR",
      "ZENOPAY_NETWORK_ERROR",
      "CANCELLED",
      "CANCELED",
      "EXPIRED",
      "REJECTED",
      "DECLINED",
    ]);

    let status = "PENDING";
    if (successSet.has(raw)) status = "SUCCESS";
    else if (failedSet.has(raw)) status = "FAILED";

    const reason =
      status === "FAILED"
        ? reasonFromJson || (raw === "ZENOPAY_ERROR" ? "Payment provider error" : raw)
        : "";

    return res.json({ status, order_id: orderId, ...(reason ? { reason } : {}) });
  } catch (err) {
    console.error("ERROR /api/payment-status:", err);
    return res.status(500).json({ status: "FAILED", error: "Could not read payment status" });
  }
});

// ======================
// CHANNELS (REAL DATABASE)
// ======================

// GET CHANNELS
app.get("/api/channels", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM channels ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("ERROR /channels:", err);
    res.status(500).json({ error: "Failed to fetch channels" });
  }
});

// ADD CHANNEL
app.post("/api/channels", async (req, res) => {
  try {
    const { name, url, category } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: "Name and URL required" });
    }

    const result = await pool.query(
      "INSERT INTO channels (name, url, category) VALUES ($1, $2, $3) RETURNING *",
      [name, url, category || "Sports"]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("ERROR ADD:", err);
    res.status(500).json({ error: "Failed to add channel" });
  }
});

// DELETE CHANNEL
app.delete("/api/channels/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query("DELETE FROM channels WHERE id = $1", [id]);

    res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("ERROR DELETE:", err);
    res.status(500).json({ error: "Failed to delete channel" });
  }
});

// ======================
// DATABASE SETUP
// ======================
async function createTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT DEFAULT 'Sports',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id SERIAL PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      device_id TEXT NOT NULL,
      device_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      zenopay_response JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// ======================
// START SERVER
// ======================
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});

// ======================
// DB INIT (BACKGROUND)
// ======================
(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("DB Connected ✅");

    await createTable();
    console.log("Database ready ✅");

  } catch (err) {
    console.error("DB ERROR:", err);
  }
})();