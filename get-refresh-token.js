require("dotenv").config();

const client_id = process.env.SPOTIFY_CLIENT_ID;
const client_secret = process.env.SPOTIFY_CLIENT_SECRET;

const code = process.argv[2];

if (!code) {
  console.log("Kasuta nii:");
  console.log("node get-refresh-token.js SINU_CODE");
  process.exit(1);
}

async function main() {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(client_id + ":" + client_secret).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: "http://127.0.0.1:8888/callback",
    }),
  });

  const data = await response.json();

  console.log("\nSpotify vastus:");
  console.log(JSON.stringify(data, null, 2));

  if (!response.ok) {
    throw new Error("Refresh tokeni küsimine ebaõnnestus.");
  }

  console.log("\nUUS REFRESH TOKEN:");
  console.log(data.refresh_token);
}

main().catch(err => {
  console.error("Viga:", err.message);
});