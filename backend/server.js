const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Server yako inafanya kazi 🚀");
});

// TEST DATA (channels)
app.get("/channels", (req, res) => {
  res.json([
    { name: "Azam Sports 1", url: "https://example.com/stream1.m3u8" },
    { name: "SuperSport Mix", url: "https://example.com/stream2.m3u8" },
    { name: "ESPN", url: "https://example.com/stream3.m3u8" },
    { name: "Sky Sports", url: "https://example.com/stream4.m3u8" },
    { name: "BT Sport", url: "https://example.com/stream5.m3u8" },
    { name: "Star Sports", url: "https://example.com/stream6.m3u8" },
  ]);
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});