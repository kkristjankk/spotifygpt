const express = require("express");
const {
  getCurrentTrack,
  pauseMusic,
  playMusic,
  nextTrack,
  previousTrack,
  createPlaylistFromSearches,
  createPlaylist,
  createAIPlaylist,
  createAIPlaylistAndPlay
} = require("./spotify");

const app = express();
app.use(express.json({ limit: "1mb" }));

function sendError(res, status, error) {
  return res.status(status).json({
    success: false,
    error: String(error)
  });
}

app.get("/", (req, res) => {
  res.json({ success: true, message: "SpotifyGPT API töötab." });
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Missing code");
  }

  try {
    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", "https://spotifygpt.onrender.com/callback");

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(
            process.env.SPOTIFY_CLIENT_ID + ":" + process.env.SPOTIFY_CLIENT_SECRET
          ).toString("base64")
      },
      body: params.toString()
    });

    const data = await tokenRes.json();

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`
      <h2>Spotify token response</h2>
      <pre>${JSON.stringify(data, null, 2)}</pre>
      <p>Kopeeri siit <b>refresh_token</b> ja pane see oma Render env variablitesse.</p>
    `);
  } catch (err) {
    return res.status(500).send(String(err));
  }
});

app.post("/spotify/pause", async (req, res) => {
  try {
    const result = await pauseMusic();
    return res.json(result);
  } catch (err) {
    console.error("POST /spotify/pause error:", err);
    return sendError(res, 500, err);
  }
});

app.post("/spotify/play", async (req, res) => {
  try {
    const result = await playMusic();
    return res.json(result);
  } catch (err) {
    console.error("POST /spotify/play error:", err);
    return sendError(res, 500, err);
  }
});

app.post("/spotify/next", async (req, res) => {
  try {
    const result = await nextTrack();
    return res.json(result);
  } catch (err) {
    console.error("POST /spotify/next error:", err);
    return sendError(res, 500, err);
  }
});

app.post("/spotify/previous", async (req, res) => {
  try {
    const result = await previousTrack();
    return res.json(result);
  } catch (err) {
    console.error("POST /spotify/previous error:", err);
    return sendError(res, 500, err);
  }
});

app.get("/spotify/current", async (req, res) => {
  try {
    const data = await getCurrentTrack();
    return res.json({ success: true, data });
  } catch (err) {
    console.error("GET /spotify/current error:", err);
    return sendError(res, 500, err);
  }
});

app.post("/spotify/playlist", async (req, res) => {
  try {
    console.log("POST /spotify/playlist body:", req.body);

    const { name, tracks } = req.body || {};
    const { playlistName, searches } = req.body || {};

    const finalName =
      typeof name === "string" && name.trim()
        ? name.trim()
        : typeof playlistName === "string" && playlistName.trim()
        ? playlistName.trim()
        : "";

    const finalTracks = Array.isArray(tracks)
      ? tracks
      : Array.isArray(searches)
      ? searches
      : [];

    const cleanedTracks = finalTracks
      .map((t) => String(t || "").trim())
      .filter(Boolean);

    if (!finalName) {
      return res.status(400).json({
        success: false,
        error: "Puudub playlisti nimi."
      });
    }

    if (!cleanedTracks.length) {
      return res.status(400).json({
        success: false,
        error: "Puudub lugude nimekiri."
      });
    }

    let result;

    if (typeof createPlaylist === "function") {
      result = await createPlaylist(finalName, cleanedTracks);

      return res.json({
        success: true,
        playlistName: result.name || finalName,
        playlistUrl: result.url || result.playlistUrl || null,
        addedTracks:
          typeof result.addedTracks === "number"
            ? result.addedTracks
            : cleanedTracks.length,
        foundTracks: result.foundTracks || [],
        missingTracks: result.missingTracks || []
      });
    }

    result = await createPlaylistFromSearches(finalName, cleanedTracks);

    return res.json({
      success: !!result.success,
      playlistName: result.name || result.playlistName || finalName,
      playlistUrl: result.url || result.playlistUrl || null,
      addedTracks:
        typeof result.addedTracks === "number"
          ? result.addedTracks
          : typeof result.tracksAdded === "number"
          ? result.tracksAdded
          : 0,
      foundTracks: result.foundTracks || [],
      missingTracks: result.missingTracks || [],
      message: result.message || null
    });
  } catch (err) {
    console.error("POST /spotify/playlist error:", err);
    return sendError(res, 500, err);
  }
});

app.post("/spotify/ai-playlist", async (req, res) => {
  try {
    console.log("POST /spotify/ai-playlist body:", req.body);

    const prompt =
      typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Prompt missing"
      });
    }

    const result = await createAIPlaylist(prompt);

    return res.json({
      success: true,
      playlistName: result.name || `SpotifyGPT – ${prompt}`,
      playlistUrl: result.url || null,
      addedTracks:
        typeof result.addedTracks === "number" ? result.addedTracks : 0,
      foundTracks: result.foundTracks || [],
      missingTracks: result.missingTracks || []
    });
  } catch (err) {
    console.error("POST /spotify/ai-playlist error:", err);
    return sendError(res, 500, err);
  }
});

app.post("/spotify/ai-dj", async (req, res) => {
  try {
    console.log("POST /spotify/ai-dj body:", req.body);

    const prompt =
      typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Prompt missing"
      });
    }

    const result = await createAIPlaylistAndPlay(prompt);

    return res.json({
      success: !!result.success,
      playlistName: result.name || `SpotifyGPT – ${prompt}`,
      playlistUrl: result.url || null,
      playlistId: result.playlistId || null,
      addedTracks:
        typeof result.addedTracks === "number" ? result.addedTracks : 0,
      foundTracks: result.foundTracks || [],
      missingTracks: result.missingTracks || [],
      playbackStarted: !!result.playbackStarted,
      message: result.message || "AI DJ playlist loodi ja käivitati."
    });
  } catch (err) {
    console.error("POST /spotify/ai-dj error:", err);
    return sendError(res, 500, err);
  }
});

app.get("/test-dj", (req, res) => {
  res.send(`
  <html>
  <head>
    <title>SpotifyGPT AI DJ Test</title>
    <style>
      body {
        font-family: Arial;
        padding: 40px;
        background: #111;
        color: white;
      }
      input {
        width: 400px;
        padding: 10px;
        font-size: 16px;
      }
      button {
        padding: 10px 20px;
        font-size: 16px;
        margin-left: 10px;
        cursor: pointer;
      }
      pre {
        margin-top: 20px;
        background: #222;
        padding: 20px;
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </head>

  <body>

  <h1>SpotifyGPT AI DJ</h1>

  <input id="prompt" placeholder="Näiteks: 90s eurodance" />
  <button onclick="play()">Play AI DJ</button>

  <pre id="result"></pre>

  <script>
  async function play() {
    const prompt = document.getElementById("prompt").value;

    const res = await fetch("/spotify/ai-dj", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt })
    });

    const data = await res.json();

    document.getElementById("result").textContent =
      JSON.stringify(data, null, 2);
  }
  </script>

  </body>
  </html>
  `);
});

app.post("/spotify/voice", async (req, res) => {
  try {
    const prompt =
      typeof req.body?.prompt === "string"
        ? req.body.prompt.toLowerCase().trim()
        : "";

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Prompt missing"
      });
    }

    console.log("VOICE COMMAND:", prompt);

    try {
      if (prompt.includes("pause") || prompt.includes("paus")) {
        const result = await pauseMusic();
        return res.json({
          ...result,
          action: "pause"
        });
      }

      if (prompt.includes("next") || prompt.includes("järgmine")) {
        const result = await nextTrack();
        return res.json({
          ...result,
          action: "next"
        });
      }

      if (prompt.includes("previous") || prompt.includes("eelmine")) {
        const result = await previousTrack();
        return res.json({
          ...result,
          action: "previous"
        });
      }

      if (prompt.includes("play") || prompt.includes("resume") || prompt.includes("jätka")) {
        const result = await playMusic();
        return res.json({
          ...result,
          action: "play"
        });
      }

      if (prompt.includes("mis mängib") || prompt.includes("what is playing")) {
        const data = await getCurrentTrack();
        return res.json({
          success: true,
          action: "current-track",
          data
        });
      }

      if (prompt.includes("loo playlist") || prompt.includes("create playlist")) {
        const result = await createAIPlaylist(prompt);

        return res.json({
          success: true,
          action: "playlist-created",
          playlistName: result.name || null,
          playlistUrl: result.url || null,
          addedTracks:
            typeof result.addedTracks === "number" ? result.addedTracks : 0,
          foundTracks: result.foundTracks || [],
          missingTracks: result.missingTracks || []
        });
      }

      const result = await createAIPlaylistAndPlay(prompt);

      return res.json({
        success: !!result.success,
        action: "ai-dj",
        playlistName: result.name || null,
        playlistUrl: result.url || null,
        playlistId: result.playlistId || null,
        addedTracks:
          typeof result.addedTracks === "number" ? result.addedTracks : 0,
        foundTracks: result.foundTracks || [],
        missingTracks: result.missingTracks || [],
        playbackStarted: !!result.playbackStarted,
        message: result.message || null
      });
    } catch (err) {
      const errorText = String(err?.message || err);

      if (
        errorText.includes("No active device found") ||
        errorText.includes("NO_ACTIVE_DEVICE")
      ) {
        return res.json({
          success: false,
          noActiveDevice: true,
          message:
            "Spotify's ei ole aktiivset seadet. Ava Spotify iPhone'is, arvutis või mõnes muus seadmes ja proovi uuesti."
        });
      }

      throw err;
    }
  } catch (err) {
    console.error("VOICE error:", err);
    return sendError(res, 500, err);
  }
});

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server töötab pordil ${PORT}`);
});