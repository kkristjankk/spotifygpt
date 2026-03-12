require("dotenv").config();

const client_id = process.env.SPOTIFY_CLIENT_ID?.trim();
const client_secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
const refresh_token = process.env.SPOTIFY_REFRESH_TOKEN?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();

let access_token = "";
let token_expiry = 0;

console.log("env loaded");

function assertEnv() {
  if (!client_id) throw new Error("SPOTIFY_CLIENT_ID missing");
  if (!client_secret) throw new Error("SPOTIFY_CLIENT_SECRET missing");
  if (!refresh_token) throw new Error("SPOTIFY_REFRESH_TOKEN missing");
}

async function refreshAccessToken() {
  assertEnv();

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(client_id + ":" + client_secret).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Token refresh failed: " + JSON.stringify(data));
  }

  access_token = data.access_token;
  token_expiry = Date.now() + Math.max((data.expires_in - 60) * 1000, 1000);

  console.log("TOKEN REFRESHED");
  return access_token;
}

async function ensureToken() {
  if (!access_token || Date.now() >= token_expiry) {
    await refreshAccessToken();
  }
}

async function api(url, options = {}, retry = true) {
  await ensureToken();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: "Bearer " + access_token,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 204) return null;

    const text = await response.text();

    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (response.status === 401 && retry) {
      console.log("API 401 -> refreshing token and retrying once");
      await refreshAccessToken();
      return api(url, options, false);
    }

    if (!response.ok) {
      throw new Error(`Spotify API error ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    }

    return data;
  } catch (err) {
    if (retry) {
      console.log("API retry:", err.message || String(err));
      return api(url, options, false);
    }
    throw err;
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function getMe() {
  return await api("https://api.spotify.com/v1/me");
}

async function getCurrentTrack() {
  const data = await api("https://api.spotify.com/v1/me/player/currently-playing");

  if (!data || !data.item) {
    return {
      isPlaying: false,
      message: "Praegu ei mängi midagi.",
    };
  }

  return {
    isPlaying: !!data.is_playing,
    track: data.item.name,
    artists: data.item.artists.map((a) => a.name).join(", "),
    album: data.item.album?.name || null,
    spotifyUrl: data.item.external_urls?.spotify || null,
  };
}

async function pauseMusic() {
  await api("https://api.spotify.com/v1/me/player/pause", {
    method: "PUT",
  });

  return { success: true, message: "Muusika pandi pausile." };
}

async function playMusic() {
  await api("https://api.spotify.com/v1/me/player/play", {
    method: "PUT",
  });

  return { success: true, message: "Muusika jätkub." };
}

async function nextTrack() {
  await api("https://api.spotify.com/v1/me/player/next", {
    method: "POST",
  });

  return { success: true, message: "Järgmine lugu." };
}

async function previousTrack() {
  await api("https://api.spotify.com/v1/me/player/previous", {
    method: "POST",
  });

  return { success: true, message: "Eelmine lugu." };
}

async function searchTrack(query) {
  const cleanQuery = cleanText(query);
  if (!cleanQuery) return null;

  const url =
    "https://api.spotify.com/v1/search?" +
    new URLSearchParams({
      q: cleanQuery,
      type: "track",
      limit: "1",
    }).toString();

  const data = await api(url);

  if (!data?.tracks?.items?.length) return null;

  return data.tracks.items[0];
}

async function createEmptyPlaylist(name, description = "Loodud SpotifyGPT assistendiga") {
  const cleanName = cleanText(name);
  if (!cleanName) {
    throw new Error("Playlist name missing");
  }

  const playlist = await api("https://api.spotify.com/v1/me/playlists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: cleanName,
      description: cleanText(description),
      public: false,
    }),
  });

  return playlist;
}

async function addTracksToPlaylist(playlistId, uris) {
  if (!playlistId) throw new Error("playlistId missing");

  const cleanUris = Array.from(
    new Set(
      (Array.isArray(uris) ? uris : [])
        .map((u) => cleanText(u))
        .filter(Boolean)
    )
  );

  if (!cleanUris.length) {
    return { snapshot_ids: [], addedTracks: 0 };
  }

  const batchSize = 100;
  const snapshotIds = [];

  for (let i = 0; i < cleanUris.length; i += batchSize) {
    const batch = cleanUris.slice(i, i + batchSize);

    const result = await api(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uris: batch,
      }),
    });

    if (result?.snapshot_id) {
      snapshotIds.push(result.snapshot_id);
    }
  }

  return {
    snapshot_ids: snapshotIds,
    addedTracks: cleanUris.length,
  };
}

async function createPlaylistFromSearches(name, searches) {
  const queries = (Array.isArray(searches) ? searches : [])
    .map((q) => cleanText(q))
    .filter(Boolean);

  if (!cleanText(name)) {
    throw new Error("Playlist name missing");
  }

  if (!queries.length) {
    throw new Error("No track searches provided");
  }

  const uris = [];
  const foundTracks = [];
  const missingTracks = [];

  for (const q of queries) {
    const track = await searchTrack(q);

    if (track) {
      uris.push(track.uri);
      foundTracks.push({
        name: track.name,
        artists: track.artists.map((a) => a.name).join(", "),
        uri: track.uri,
      });
    } else {
      missingTracks.push(q);
    }
  }

  if (!uris.length) {
    return {
      success: false,
      message: "Ühtegi lugu ei leitud. Playlisti ei loodud.",
      name,
      url: null,
      addedTracks: 0,
      foundTracks: [],
      missingTracks,
    };
  }

  const playlist = await createEmptyPlaylist(
    name,
    "Loodud automaatselt SpotifyGPT assistendiga"
  );

  const addResult = await addTracksToPlaylist(playlist.id, uris);

  return {
    success: true,
    name: playlist.name,
    playlistId: playlist.id,
    url: playlist.external_urls?.spotify || null,
    addedTracks: addResult.addedTracks || uris.length,
    foundTracks,
    missingTracks,
  };
}

async function createPlaylist(name, tracksOrDescription = []) {
  if (Array.isArray(tracksOrDescription)) {
    return await createPlaylistFromSearches(name, tracksOrDescription);
  }

  const playlist = await createEmptyPlaylist(name, tracksOrDescription);
  return {
    success: true,
    name: playlist.name,
    playlistId: playlist.id,
    url: playlist.external_urls?.spotify || null,
    addedTracks: 0,
    foundTracks: [],
    missingTracks: [],
  };
}

async function generateAIPlaylist(prompt) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing");
  }

  const cleanPrompt = cleanText(prompt);
  if (!cleanPrompt) {
    throw new Error("AI playlist prompt missing");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.8,
      messages: [
        {
          role: "system",
          content:
            "Generate exactly 15 playlist tracks for Spotify. Return only a plain text list, one item per line, in the format 'Artist - Song'. No intro, no commentary.",
        },
        {
          role: "user",
          content: cleanPrompt,
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error("OpenAI error: " + JSON.stringify(data));
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI returned empty playlist");
  }

  const songs = text
    .split("\n")
    .map((s) => s.replace(/^\s*[-*]?\s*\d*\.?\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 15);

  if (!songs.length) {
    throw new Error("AI generated no usable songs");
  }

  return songs;
}

async function createAIPlaylist(prompt) {
  const cleanPrompt = cleanText(prompt);
  console.log("Generating AI playlist:", cleanPrompt);

  const songs = await generateAIPlaylist(cleanPrompt);

  return await createPlaylistFromSearches(`SpotifyGPT – ${cleanPrompt}`, songs);
}

async function showHelp() {
  console.log(`
Kasutus:

node spotify.js me
node spotify.js current
node spotify.js play
node spotify.js pause
node spotify.js next
node spotify.js prev

Playlist:
node spotify.js playlist "Chill õhtu" "The Weeknd Blinding Lights" "Dua Lipa Levitating" "Daft Punk Get Lucky"

AI Playlist:
node spotify.js ai "90s eurodance"
`);
}

async function main() {
  const command = process.argv[2];

  if (!command) {
    await showHelp();
    return;
  }

  if (command === "me") {
    console.log(await getMe());
    return;
  }

  if (command === "current") {
    console.log(await getCurrentTrack());
    return;
  }

  if (command === "play") {
    console.log(await playMusic());
    return;
  }

  if (command === "pause") {
    console.log(await pauseMusic());
    return;
  }

  if (command === "next") {
    console.log(await nextTrack());
    return;
  }

  if (command === "prev") {
    console.log(await previousTrack());
    return;
  }

  if (command === "playlist") {
    const playlistName = process.argv[3];
    const searches = process.argv.slice(4);

    if (!playlistName || searches.length === 0) {
      console.log('Näide: node spotify.js playlist "Chill õhtu" "The Weeknd Blinding Lights" "Dua Lipa Levitating"');
      return;
    }

    console.log(await createPlaylistFromSearches(playlistName, searches));
    return;
  }

  if (command === "ai") {
    const prompt = process.argv.slice(3).join(" ");

    if (!prompt) {
      console.log('Näide: node spotify.js ai "90s eurodance"');
      return;
    }

    console.log(await createAIPlaylist(prompt));
    return;
  }

  await showHelp();
}

module.exports = {
  getMe,
  getCurrentTrack,
  pauseMusic,
  playMusic,
  nextTrack,
  previousTrack,
  searchTrack,
  createPlaylist,
  addTracksToPlaylist,
  createPlaylistFromSearches,
  createAIPlaylist,
  refreshAccessToken,
  api,
};

if (require.main === module) {
  main().catch((err) => {
    console.error("Viga:", err);
    process.exit(1);
  });
}