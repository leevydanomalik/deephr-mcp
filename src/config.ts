export interface Config {
  apiUrl: string;
  email: string;
  password: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const email = env.DEEPHR_EMAIL;
  const password = env.DEEPHR_PASSWORD;
  if (!email) throw new Error("Missing required env: DEEPHR_EMAIL");
  if (!password) throw new Error("Missing required env: DEEPHR_PASSWORD");
  return {
    apiUrl: env.DEEPHR_API_URL ?? "http://localhost:4445",
    email,
    password,
  };
}
