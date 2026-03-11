```markdown
## Eesmärk

SpotifyGPT võimaldab ChatGPT kaudu juhtida Spotify't:

- paus
- play
- next track
- current track
- playlist creation

# SpotifyGPT 🎧🤖

SpotifyGPT on Node.js backend, mis ühendab **Spotify Web API** ja **ChatGPT Custom GPT Actions**.

See võimaldab ChatGPT kaudu juhtida Spotify't.

Näiteks saab ChatGPT kaudu teha:

- ⏯ Play / Pause muusika
- ⏭ Järgmine lugu
- ⏮ Eelmine lugu
- 🎵 Vaadata, mis lugu praegu mängib
- 📀 Luua Spotify playlist

Projekt töötab ka **ChatGPT iPhone rakenduses häälkäsklustega**.

---

# Arhitektuur

ChatGPT (Custom GPT)
↓
OpenAPI Actions
↓
ngrok tunnel
↓
Node.js server
↓
Spotify Web API
↓
Spotify konto

# Projekti struktuur

spotify-test/
│
├── server.js
├── spotify.js
├── token.js
├── .env
├── package.json
├── node_modules
└── README.md

# Nõuded

Projekt vajab:

- Node.js
- Spotify Developer konto
- ngrok
- ChatGPT Plus konto (Custom GPT jaoks)

---

# Spotify Developer setup

1. Mine:


https://developer.spotify.com/dashboard


2. Loo uus App

3. Salvesta:


Client ID
Client Secret


4. Lisa Redirect URI:


http://127.0.0.1:8888/callback


---

# .env konfiguratsioon

Loo projekti kausta `.env` fail.

Näiteks:


SPOTIFY_CLIENT_ID=YOUR_CLIENT_ID
SPOTIFY_CLIENT_SECRET=YOUR_CLIENT_SECRET
SPOTIFY_REFRESH_TOKEN=YOUR_REFRESH_TOKEN


---

# Refresh tokeni loomine

1. Käivita authorization URL:


node auth-url.js


2. Logi Spotify'sse sisse

3. Kopeeri `code` callback URL-ist

4. Käivita:


node get-refresh-token.js


5. Salvesta saadud refresh token `.env` faili.

---

# Sõltuvuste install


npm install


---

# Serveri käivitamine


node server.js


Server töötab aadressil:


http://localhost:3000


---

# ngrok tunnel

ChatGPT ei saa otse localhostiga rääkida.  
Selleks kasutatakse **ngrok tunnelit**.

Install:


npm install -g ngrok


Käivita tunnel:


ngrok http 3000


Ngrok annab URL-i näiteks:


https://abc123.ngrok-free.dev


---

# ⚠ Väga oluline

Ngrok URL **muutub iga kord kui tunnel uuesti käivitub**.

Kui URL muutub, tuleb uuendada **Custom GPT OpenAPI schema** sees:


servers → url


Näiteks:


"url": "https://abc123.ngrok-free.dev
"


---

# API endpointid

Server pakub järgmisi endpoint'e:


GET /spotify/current
POST /spotify/play
POST /spotify/pause
POST /spotify/next
POST /spotify/previous
POST /spotify/playlist


---

# Näide API vastusest


GET /spotify/current


Vastus:

```json
{
 "success": true,
 "data": {
   "isPlaying": true,
   "track": "Blinding Lights",
   "artists": "The Weeknd",
   "album": "After Hours"
 }
}
Playlisti loomine

POST /spotify/playlist


Body:

{
 "playlistName": "Chill õhtu",
 "searches": [
   "The Weeknd Blinding Lights",
   "Dua Lipa Levitating"
 ]
}
ChatGPT Custom GPT setup

Mine:


ChatGPT → Explore GPTs → Create


Lisa Actions ja kleebi OpenAPI schema.

Schema peab kasutama ngrok URL-i:


servers:
  url: https://abc123.ngrok-free.dev

Näited ChatGPT kasutamisest

Mis lugu praegu mängib?


Pane muusika pausile


Mängi järgmine lugu

Kui GPT ei tööta

Kontrolli:

kas server töötab


node server.js


kas ngrok töötab


ngrok http 3000


kas OpenAPI schema servers.url on õige

kas Spotify refresh token kehtib

Tuleviku ideed

Võimalikud edasiarendused:

AI playlist generator

Spotify recommendation API

häälkäsklused ChatGPT voice mode kaudu

automaatne muusikasoovitus

mitme kasutaja tugi

Autor

SpotifyGPT projekt on loodud Spotify Web API ja ChatGPT integratsiooni katsetamiseks.


---

💡 Soovitan teha projekti ka **`.gitignore` faili**, et `.env` (kus on Spotify võtmed) kogemata GitHubi ei satuks.

Kui tahad, võin järgmises vastuses teha sulle ka:

- **täiusliku `.gitignore` Node.js projektile**
- **SpotifyGPT projekti diagrammi**
- **AI playlist generatori**, mis teeb käsu  
  *“tee mulle chill playlist”* automaatselt Spotify playlistiks.