type GithubAccessTokenResponse = {
  readonly access_token?: unknown;
  readonly token_type?: unknown;
  readonly scope?: unknown;
  readonly error?: unknown;
  readonly error_description?: unknown;
};

type GithubUserResponse = {
  readonly id?: unknown;
  readonly login?: unknown;
  readonly name?: unknown;
  readonly avatar_url?: unknown;
};

type GithubEmailResponse = {
  readonly email?: unknown;
  readonly primary?: unknown;
  readonly verified?: unknown;
};

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function postTokenExchange(input: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly redirectUrl: string;
}): Promise<GithubAccessTokenResponse> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUrl,
    }),
  });

  const json = (await readJson(res)) as GithubAccessTokenResponse;
  if (!res.ok) {
    const message =
      typeof json === "object" &&
      json !== null &&
      typeof (json as { error_description?: unknown }).error_description === "string"
        ? String((json as { error_description: string }).error_description)
        : `GitHub token exchange failed (${res.status})`;
    throw new Error(message);
  }

  return json;
}

export async function getUser(accessToken: string): Promise<GithubUserResponse> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const json = (await readJson(res)) as GithubUserResponse;
  if (!res.ok) throw new Error(`GitHub user fetch failed (${res.status})`);
  return json;
}

export async function getEmails(accessToken: string): Promise<readonly GithubEmailResponse[]> {
  const res = await fetch("https://api.github.com/user/emails", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const json = await readJson(res);
  if (!res.ok) throw new Error(`GitHub email fetch failed (${res.status})`);
  if (!Array.isArray(json)) throw new Error("Invalid GitHub emails response");
  return json as readonly GithubEmailResponse[];
}
