const { Pool } = require("pg");
const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.get("/", (req, res) => {
  res.send("Server yako inafanya kazi 🚀");
});

app.get("/channels", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM channels ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch channels" });
  }
});

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

async function start() {
  await createTable();
  app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
