import { expect, request } from "@playwright/test";
import { LB, PASSWORD } from "./helpers";

export default async function globalSetup() {
  const anonymous = await request.newContext({ baseURL: LB });
  await expect(async () => {
    expect((await anonymous.get("/auth/login")).ok()).toBeTruthy();
  }).toPass({ timeout: 120_000 });

  await anonymous.post("/api/auth/register", { data: { username: "admin", password: PASSWORD } });
  const admin = await request.newContext({ baseURL: LB });
  await admin.post("/api/auth/login", { data: { username: "admin", password: PASSWORD } });
  for (const username of ["alice", "bob", "eve"]) {
    await admin.post("/api/auth/register", { data: { username, password: PASSWORD } });
  }
}
