require("dotenv").config();

const client_id = process.env.SPOTIFY_CLIENT_ID?.trim();
const client_secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
const refresh_token = process.env.SPOTIFY_REFRESH_TOKEN?.trim();

console.log("env loaded:");
console.log("client_id olemas:", !!client_id, "length:", client_id?.length);
console.log("client_secret olemas:", !!client_secret, "length:", client_secret?.length);
console.log("refresh_token olemas:", !!refresh_token, "length:", refresh_token?.length);

let access_token = "";
let last_token_scope = null;

async function refreshAccessToken() {
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
      refresh_token: refresh_token,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Tokeni uuendamine ebaõnnestus: " + JSON.stringify(data));
  }

  access_token = data.access_token;
  last_token_scope = data.scope || null;

  console.log("TOKEN REFRESH DEBUG");
  console.log("access_token olemas:", !!access_token);
  console.log("returned scope:", last_token_scope);
  console.log("token_type:", data.token_type);
  console.log("expires_in:", data.expires_in);

  return access_token;
}

async function api(url, options = {}, retry = true) {
  if (!access_token) {
    await refreshAccessToken();
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: "Bearer " + access_token,
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (response.status === 401 && retry) {
    console.log("API DEBUG - 401, proovin tokeni uuendada ja retry");
    await refreshAccessToken();
    return await api(url, options, false);
  }

  if (!response.ok) {
    console.log("API ERROR DEBUG");
    console.log("url:", url);
    console.log("method:", options.method || "GET");
    console.log("status:", response.status);
    console.log("response:", data);
    console.log("last_token_scope:", last_token_scope);
    console.log("www-authenticate:", response.headers.get("www-authenticate"));
    console.log("retry-after:", response.headers.get("retry-after"));

    throw new Error(`Spotify API viga (${response.status}): ${JSON.stringify(data)}`);
  }

  return data;
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
    isPlaying: true,
    track: data.item.name,
    artists: data.item.artists.map((a) => a.name).join(", "),
    album: data.item.album.name,
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
  const url =
    "https://api.spotify.com/v1/search?" +
    new URLSearchParams({
      q: query,
      type: "track",
      limit: "1",
    }).toString();

  const data = await api(url);

  if (!data?.tracks?.items?.length) {
    console.log("SEARCH DEBUG - ei leidnud lugu:", query);
    return null;
  }

  const track = data.tracks.items[0];
  console.log("SEARCH DEBUG - leitud:", {
    query,
    name: track.name,
    artists: track.artists.map((a) => a.name).join(", "),
    uri: track.uri,
  });

  return track;
}

async function createEmptyPlaylist(
  name,
  description = "Loodud Node.js Spotify assistendiga"
) {
  const playlist = await api("https://api.spotify.com/v1/me/playlists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      description,
      public: false,
    }),
  });

  console.log("PLAYLIST CREATE DEBUG");
  console.log("playlist.id:", playlist?.id);
  console.log("playlist.name:", playlist?.name);
  console.log("playlist.owner.id:", playlist?.owner?.id);
  console.log("playlist.public:", playlist?.public);
  console.log("playlist.collaborative:", playlist?.collaborative);
  console.log("playlist.snapshot_id:", playlist?.snapshot_id);

  return playlist;
}

async function addTracksToPlaylist(playlistId, uris) {
  console.log("ADD TRACKS DEBUG");
  console.log("playlistId:", playlistId);
  console.log("uris:", uris);
  console.log("uri count:", Array.isArray(uris) ? uris.length : 0);

  try {
    console.log("ADD TRACKS TRY 1 - JSON body");

    return await api(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uris,
      }),
    });
  } catch (err) {
    console.log("ADD TRACKS TRY 1 FAILED:", String(err));
    console.log("ADD TRACKS TRY 2 - query params fallback");

    const url =
      `https://api.spotify.com/v1/playlists/${playlistId}/items?` +
      new URLSearchParams({
        uris: uris.join(","),
      }).toString();

    return await api(url, {
      method: "POST",
    });
  }
}

async function createPlaylistFromSearches(playlistName, searches) {
  const uris = [];
  const foundTracks = [];
  const missingTracks = [];

  console.log("CREATE PLAYLIST DEBUG");
  console.log("playlistName:", playlistName);
  console.log("searches:", searches);

  for (const q of searches) {
    const track = await searchTrack(q);

    if (track) {
      const artists = track.artists.map((a) => a.name).join(", ");
      uris.push(track.uri);
      foundTracks.push({
        name: track.name,
        artists,
        uri: track.uri,
      });
    } else {
      missingTracks.push(q);
    }
  }

  console.log("FOUND TRACKS DEBUG");
  console.log("foundTracks:", foundTracks);
  console.log("missingTracks:", missingTracks);

  if (!uris.length) {
    return {
      success: false,
      message: "Ühtegi lugu ei leitud. Playlisti ei loodud.",
      foundTracks: [],
      missingTracks,
    };
  }

  const me = await getMe();
  console.log("ME DEBUG");
  console.log("me.id:", me?.id);
  console.log("me.display_name:", me?.display_name);
  console.log("me.email:", me?.email);

  const playlist = await createEmptyPlaylist(
    playlistName,
    "Loodud automaatselt sinu soovide põhjal"
  );

  console.log("PLAYLIST BEFORE ADD DEBUG");
  console.log("playlist.id:", playlist?.id);
  console.log("playlist.owner.id:", playlist?.owner?.id);
  console.log("playlist.external_urls:", playlist?.external_urls);

  const addResult = await addTracksToPlaylist(playlist.id, uris);

  console.log("ADD RESULT DEBUG");
  console.log(addResult);

  return {
    success: true,
    playlistName: playlist.name,
    playlistId: playlist.id,
    playlistUrl: playlist.external_urls.spotify,
    tracksAdded: uris.length,
    foundTracks,
    missingTracks,
  };
}

async function createPlaylist(
  name,
  descriptionOrTracks = "Loodud Node.js Spotify assistendiga"
) {
  if (Array.isArray(descriptionOrTracks)) {
    const result = await createPlaylistFromSearches(name, descriptionOrTracks);

    return {
      name: result.playlistName,
      id: result.playlistId,
      url: result.playlistUrl,
      addedTracks: result.tracksAdded || 0,
      foundTracks: result.foundTracks || [],
      missingTracks: result.missingTracks || [],
      success: result.success,
      message: result.message || null,
    };
  }

  return await createEmptyPlaylist(name, descriptionOrTracks);
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

Lisa lood olemasolevasse playlisti:
node spotify.js addtest PLAYLIST_ID "spotify:track:69kOkLUCkxIZYexIgSG8rq" "spotify:track:6Xe9wT5xeZETPwtaP2ynUz"
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

  if (command === "addtest") {
    const playlistId = process.argv[3];
    const uris = process.argv.slice(4);

    if (!playlistId || uris.length === 0) {
      console.log('Näide: node spotify.js addtest PLAYLIST_ID "spotify:track:..." "spotify:track:..."');
      return;
    }

    console.log(await addTracksToPlaylist(playlistId, uris));
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
  refreshAccessToken,
  api,
};

if (require.main === module) {
  main().catch((err) => {
    console.error("Viga:", err);
  });
}