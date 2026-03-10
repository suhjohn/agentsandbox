import { postTokenExchange, getUser, getEmails } from "../../clients/github";

export type GithubProfile = {
  readonly githubId: string;
  readonly login: string;
  readonly name: string | null;
  readonly email: string;
  readonly avatarUrl: string | null;
};

export type OAuthStartResult = {
  readonly state: string;
  readonly authUrl: string;
  readonly cookies: readonly string[];
};

export type OAuthCallbackResult = {
  readonly ok: boolean;
  readonly html: string;
  readonly cookiesToClear: readonly string[];
};

type GithubEmailResponse = {
  readonly email?: unknown;
  readonly primary?: unknown;
  readonly verified?: unknown;
};

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function pickPrimaryVerifiedEmail(emails: readonly GithubEmailResponse[]): string | null {
  for (const e of emails) {
    if (typeof e.email !== "string") continue;
    if (e.primary === true && e.verified === true) return e.email;
  }
  for (const e of emails) {
    if (typeof e.email === "string" && e.verified === true) return e.email;
  }
  return null;
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function cookieSecureFlag(reqUrl: string): string {
  try {
    const url = new URL(reqUrl);
    return url.protocol === "https:" ? "; Secure" : "";
  } catch {
    return "";
  }
}

function htmlOAuthResult(input: {
  readonly ok: boolean;
  readonly origin: string;
  readonly payload: Record<string, unknown>;
}): string {
  const json = JSON.stringify(input.payload);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub login</title>
  </head>
  <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;">
    <div style="max-width: 520px; margin: 40px auto; padding: 16px;">
      <h2>${input.ok ? "Signed in" : "Sign in failed"}</h2>
      <p>You can close this window.</p>
    </div>
    <script>
      try {
        if (window.opener) {
          window.opener.postMessage(${json}, ${JSON.stringify(input.origin)});
        }
      } catch {}
      try { window.close(); } catch {}
    </script>
  </body>
</html>`;
}

export async function exchangeGithubCodeForAccessToken(input: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly redirectUrl: string;
}): Promise<string> {
  const json = await postTokenExchange(input);
  const accessToken = json?.access_token;
  return expectString(accessToken, "GitHub access token");
}

async function fetchGithubUser(accessToken: string): Promise<{
  readonly githubId: string;
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}> {
  const json = await getUser(accessToken);

  const id = json?.id;
  const login = json?.login;
  const name = json?.name;
  const avatarUrl = json?.avatar_url;

  const githubId = typeof id === "number" ? String(id) : typeof id === "string" ? id : "";
  if (!githubId) throw new Error("Invalid GitHub user id");

  return {
    githubId,
    login: expectString(login, "GitHub login"),
    name: typeof name === "string" && name.trim().length > 0 ? name : null,
    avatarUrl:
      typeof avatarUrl === "string" && avatarUrl.trim().length > 0
        ? avatarUrl
        : null,
  };
}

async function fetchGithubPrimaryEmail(accessToken: string): Promise<string> {
  const emails = await getEmails(accessToken);
  const email = pickPrimaryVerifiedEmail(emails as readonly GithubEmailResponse[]);
  if (!email) throw new Error("No verified GitHub email found");
  return email;
}

export async function fetchGithubProfile(accessToken: string): Promise<GithubProfile> {
  const [user, email] = await Promise.all([
    fetchGithubUser(accessToken),
    fetchGithubPrimaryEmail(accessToken),
  ]);

  return {
    githubId: user.githubId,
    login: user.login,
    name: user.name,
    email,
    avatarUrl: user.avatarUrl,
  };
}

export function startGithubOAuth(input: {
  readonly clientId: string;
  readonly redirectUrl: string;
  readonly returnOrigin: string;
  readonly requestUrl: string;
}): OAuthStartResult {
  const state = randomState();
  const secure = cookieSecureFlag(input.requestUrl);

  const cookies = [
    `githubOauthState=${encodeURIComponent(state)}; HttpOnly${secure}; SameSite=Lax; Path=/auth/github; Max-Age=${10 * 60}`,
    `githubOauthReturnTo=${encodeURIComponent(input.returnOrigin)}; HttpOnly${secure}; SameSite=Lax; Path=/auth/github; Max-Age=${10 * 60}`,
  ];

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  url.searchParams.set("scope", "user:email");
  url.searchParams.set("state", state);

  return {
    state,
    authUrl: url.toString(),
    cookies,
  };
}

export async function handleGithubCallback(input: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUrl: string;
  readonly code: string;
  readonly state: string;
  readonly cookieState: string;
  readonly returnOrigin: string;
  readonly requestUrl: string;
  readonly onSuccess: (profile: GithubProfile) => Promise<{
    readonly user: {
      readonly id: string;
      readonly name: string;
      readonly email: string;
      readonly avatar: string | null;
    };
    readonly accessToken: string;
    readonly refreshToken: string;
  }>;
}): Promise<OAuthCallbackResult> {
  const secure = cookieSecureFlag(input.requestUrl);
  const cookiesToClear = [
    `githubOauthState=; HttpOnly${secure}; SameSite=Lax; Path=/auth/github; Max-Age=0`,
    `githubOauthReturnTo=; HttpOnly${secure}; SameSite=Lax; Path=/auth/github; Max-Age=0`,
  ];

  if (input.state !== input.cookieState) {
    const html = htmlOAuthResult({
      ok: false,
      origin: input.returnOrigin,
      payload: { type: "agent-manager-auth", ok: false, error: "Invalid OAuth state" },
    });
    return { ok: false, html, cookiesToClear };
  }

  try {
    const accessToken = await exchangeGithubCodeForAccessToken({
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      code: input.code,
      redirectUrl: input.redirectUrl,
    });

    const profile = await fetchGithubProfile(accessToken);
    const result = await input.onSuccess(profile);

    const html = htmlOAuthResult({
      ok: true,
      origin: input.returnOrigin,
      payload: {
        type: "agent-manager-auth",
        ok: true,
        user: result.user,
        accessToken: result.accessToken,
      },
    });

    return { ok: true, html, cookiesToClear };
  } catch (e) {
    const message = e instanceof Error ? e.message : "GitHub login failed";
    const html = htmlOAuthResult({
      ok: false,
      origin: input.returnOrigin,
      payload: { type: "agent-manager-auth", ok: false, error: message },
    });
    return { ok: false, html, cookiesToClear };
  }
}
