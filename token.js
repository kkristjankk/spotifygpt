const client_id = "ffe95eac3d5a46ff93db549bf0b943fb";
const client_secret = "e4f96ad7310f403d92b7905be614e8eb";
const code = "AQDX5C08aQps04SKogmNlC8JkompRQOo0G7Pz8m8k_9xTFgPz4p1Q2qR60u0yw-ZgFzX5P24j2k2eqWEXkoO6Mxwiv9CqRhUtvUgXCNXxnOiFQ3z6ABvY1rg3kl7iPAwk9s-ROAyDwAuyXmaGmtOuKj_QWXSfmRPGgA9FA0B_Ho0jIN4BeMJo6XevyGJ5WGXUWAlT-b0luPDxgesAo-LdxsJKS_gOSUMtHG_aqX50zvYNKpAac1Ryg";

const redirect_uri = "http://127.0.0.1:3000/callback";

async function getToken() {
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
      code,
      redirect_uri,
    }),
  });

  const data = await response.json();
  console.log(data);
}

getToken();