const { Pool } = require("pg");
const express = require("express");
const createPaymentsRouter = require("./routes/payments");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

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