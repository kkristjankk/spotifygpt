const express = require("express");
const {
  getCurrentTrack,
  pauseMusic,
  playMusic,
  nextTrack,
  previousTrack,
  createPlaylistFromSearches,
  createPlaylist
} = require("./spotify");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ success: true, message: "SpotifyGPT API töötab." });
});

app.post("/spotify/pause", async (req, res) => {
  try {
    const result = await pauseMusic();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post("/spotify/play", async (req, res) => {
  try {
    const result = await playMusic();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post("/spotify/next", async (req, res) => {
  try {
    const result = await nextTrack();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post("/spotify/previous", async (req, res) => {
  try {
    const result = await previousTrack();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get("/spotify/current", async (req, res) => {
  try {
    const data = await getCurrentTrack();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post("/spotify/playlist", async (req, res) => {
  try {
    // Uus formaat Custom GPT jaoks
    const { name, tracks } = req.body;

    // Vana formaat jääb ka toetatuks
    const { playlistName, searches } = req.body;

    const finalName = name || playlistName;
    const finalTracks = Array.isArray(tracks) ? tracks : searches;

    if (!finalName || !Array.isArray(finalTracks) || finalTracks.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Puudub playlisti nimi või lugude nimekiri. Kasuta kas 'name' + 'tracks' või 'playlistName' + 'searches'."
      });
    }

    let result;

    // Kui spotify.js failis on olemas uus createPlaylist(name, tracks) funktsioon,
    // kasutame seda. Kui ei ole, siis kasutame vana createPlaylistFromSearches varianti.
    if (typeof createPlaylist === "function") {
      result = await createPlaylist(finalName, finalTracks);

      return res.json({
        success: true,
        playlistName: result.name || finalName,
        playlistUrl: result.url || result.playlistUrl || null,
        addedTracks:
          typeof result.addedTracks === "number"
            ? result.addedTracks
            : Array.isArray(finalTracks)
            ? finalTracks.length
            : 0
      });
    }

    result = await createPlaylistFromSearches(finalName, finalTracks);
    return res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.listen(3000, () => {
  console.log("Server töötab pordil 3000");
});