require("dotenv").config();

const client_id = process.env.SPOTIFY_CLIENT_ID?.trim();
const client_secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
const refresh_token = process.env.SPOTIFY_REFRESH_TOKEN?.trim();

console.log("env loaded:");
console.log("client_id olemas:", !!client_id, "length:", client_id?.length);
console.log("client_secret olemas:", !!client_secret, "length:", client_secret?.length);
console.log("refresh_token olemas:", !!refresh_token, "length:", refresh_token?.length);

let access_token = "";

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

  // Kui access token on aegunud, uuenda see ja proovi 1 kord uuesti
  if (response.status === 401 && retry) {
    await refreshAccessToken();
    return await api(url, options, false);
  }

  if (!response.ok) {
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
    artists: data.item.artists.map(a => a.name).join(", "),
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
    return null;
  }

  return data.tracks.items[0];
}

// Sisemine funktsioon: loob tühja playlisti
async function createEmptyPlaylist(
  name,
  description = "Loodud Node.js Spotify assistendiga"
) {
  return await api("https://api.spotify.com/v1/me/playlists", {
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
}

async function addTracksToPlaylist(playlistId, uris) {
  return await api(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uris,
    }),
  });
}

async function createPlaylistFromSearches(playlistName, searches) {
  const uris = [];
  const foundTracks = [];
  const missingTracks = [];

  for (const q of searches) {
    const track = await searchTrack(q);

    if (track) {
      const artists = track.artists.map(a => a.name).join(", ");
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

  if (!uris.length) {
    return {
      success: false,
      message: "Ühtegi lugu ei leitud. Playlisti ei loodud.",
      foundTracks: [],
      missingTracks,
    };
  }

  const playlist = await createEmptyPlaylist(
    playlistName,
    "Loodud automaatselt sinu soovide põhjal"
  );

  await addTracksToPlaylist(playlist.id, uris);

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

// Ühilduv createPlaylist:
// 1) createPlaylist("Nimi", "kirjeldus")
// 2) createPlaylist("Nimi", ["Artist - Song", "Artist - Song"])
async function createPlaylist(name, descriptionOrTracks = "Loodud Node.js Spotify assistendiga") {
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
  main().catch(err => {
    console.error("Viga:", err);
  });
}