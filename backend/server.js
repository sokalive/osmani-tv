const { Pool } = require("pg");
const express = require("express");

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