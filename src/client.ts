import type { Config } from "./config";

type FetchFn = typeof fetch;

export class DeepHrClient {
  private token: string | undefined;

  constructor(
    private readonly cfg: Config,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async login(): Promise<void> {
    const res = await this.fetchFn(`${this.cfg.apiUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: this.cfg.email, password: this.cfg.password }),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; token?: string; error?: string };
    if (!res.ok || !body.success || !body.token) {
      throw new Error(`deepHR login failed (${res.status}): ${body.error ?? "no token returned"}`);
    }
    this.token = body.token;
  }

  /** Returns true if a fresh token was obtained. */
  private async refresh(): Promise<boolean> {
    if (!this.token) return false;
    const res = await this.fetchFn(`${this.cfg.apiUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; token?: string };
    if (!body.success || !body.token) return false;
    this.token = body.token;
    return true;
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(this.cfg.apiUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async fire(method: string, url: string): Promise<Response> {
    return this.fetchFn(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}` },
    });
  }

  async request(method: string, path: string, query?: Record<string, unknown>): Promise<unknown> {
    if (!this.token) await this.login();
    const url = this.buildUrl(path, query);

    let res = await this.fire(method, url);

    if (res.status === 401) {
      const refreshed = await this.refresh();
      if (!refreshed) await this.login();
      res = await this.fire(method, url);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`deepHR API ${res.status} for ${method} ${path}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }
}
