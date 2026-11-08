import { expect, test, type Browser, type Page } from "@playwright/test";

const A = { email: "alice@example.com", pw: "alice-password-1", token: process.env.TOKEN_A! };
const B = { email: "bob@example.com", pw: "bob-password-123", token: process.env.TOKEN_B! };

async function setPassword(page: Page, u: typeof A) {
  await page.goto(`/#/setup/${u.token}`);
  await page.getByLabel(/New password/).fill(u.pw);
  await page.getByLabel("Repeat password").fill(u.pw);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

async function signIn(page: Page, u: typeof A) {
  await page.goto("/");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.pw);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "📅 Today" })).toBeVisible();
}

async function device(browser: Browser, u: typeof A) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, u);
  return { ctx, page };
}

const serverHas = (p: Page, text: string) =>
  expect
    .poll(async () => p.evaluate(async (t) => {
      const r = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cursor: 0, changes: [] }) });
      return JSON.stringify(await r.json()).includes(t);
    }, text), { timeout: 20_000 })
    .toBe(true);

const synced = (p: Page) => expect(p.getByRole("button", { name: /^Synced/ })).toBeVisible({ timeout: 15_000 });

test.describe.configure({ mode: "serial" });

test("invite flow rejects reuse and bad logins", async ({ page }) => {
  await setPassword(page, A);
  await page.goto(`/#/setup/${A.token}`);
  await page.getByLabel(/New password/).fill("another-password-1");
  await page.getByLabel("Repeat password").fill("another-password-1");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("alert")).toContainText("already used");
  await page.goto("/");
  await page.getByLabel("Email").fill(A.email);
  await page.getByLabel("Password").fill("wrong-password-xx");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Wrong email or password");
});

let devA1: Awaited<ReturnType<typeof device>>;

test("daily note, slash menu and persistence", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, A);
  await expect(page.locator(".ProseMirror h2").first()).toHaveText("Tasks");
  // type into the Notes paragraph (last block)
  await page.locator(".ProseMirror p").last().click();
  await page.keyboard.type("/head");
  await expect(page.getByRole("option", { name: /Heading 1/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Hello Daybook");
  await expect(page.locator(".ProseMirror h1")).toHaveText("Hello Daybook");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- first bullet");
  await expect(page.locator(".ProseMirror ul:not([data-type=taskList]) li").first()).toContainText("first bullet");
  await serverHas(page, "first bullet");
  await page.reload();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Hello Daybook");
  devA1 = { ctx, page };
});

test("a second device sees the note", async ({ browser }) => {
  const d2 = await device(browser, A);
  await expect(d2.page.locator(".ProseMirror h1")).toHaveText("Hello Daybook", { timeout: 15_000 });
  await d2.ctx.close();
});

test("offline edits sync when the connection returns", async ({ browser }) => {
  const { ctx, page } = devA1;
  await ctx.setOffline(true);
  await page.locator(".ProseMirror p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" written offline");
  await page.waitForTimeout(800); // let the local save happen
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await serverHas(page, "written offline");
  const d2 = await device(browser, A);
  await expect(d2.page.locator(".ProseMirror")).toContainText("written offline", { timeout: 15_000 });
  await d2.ctx.close();
});

test("another account cannot see these notes", async ({ browser }) => {
  const adm = await browser.newContext();
  const pg = await adm.newPage();
  await setPassword(pg, B);
  await adm.close();
  const b = await device(browser, B);
  await b.page.getByPlaceholder("Search…").fill("Daybook");
  await expect(b.page.getByText("No matches")).toBeVisible();
  const res = await b.page.evaluate(async () =>
    (await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cursor: 0, changes: [] }) })).json(),
  );
  expect(JSON.stringify(res)).not.toContain("Hello Daybook");
  await b.ctx.close();
});

test("new page, image and database", async () => {
  const { page } = devA1;
  await page.getByRole("button", { name: "＋ New page" }).click();
  await page.getByLabel("Page title").fill("Trip plan");
  await page.locator(".ProseMirror p").first().click();
  await page.keyboard.type("/image");
  await page.getByRole("option", { name: /Image/ }).click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.locator("input[type=file]").last().setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".img-block img")).toBeVisible();
  // the image bytes reach the server (uploaded on the next sync)
  await expect
    .poll(async () => page.evaluate(async () => {
      const sha = await new Promise<string>((r) => {
        const q = indexedDB.open("daybook");
        q.onsuccess = () => {
          const g = q.result.transaction("blobs").objectStore("blobs").getAllKeys();
          g.onsuccess = () => r(String(g.result[0]));
        };
      });
      return (await fetch(`/files/${sha}`)).status;
    }), { timeout: 20_000 })
    .toBe(200);

  await page.getByRole("button", { name: "▦ New database" }).click();
  await page.getByLabel("Page title").fill("Tasks board");
  await page.getByRole("button", { name: "＋ New row" }).click();
  await page.getByLabel("Row name").first().fill("Write tests");
  await page.getByLabel("Status", { exact: true }).first().fill("doing");
  await expect(page.getByLabel("Row name").first()).toHaveValue("Write tests");
  await page.getByPlaceholder("Filter rows…").fill("nothing");
  await expect(page.getByText("No rows match the filter.")).toBeVisible();
});

test("trash and restore", async () => {
  const { page } = devA1;
  await page.getByRole("button", { name: "Move to trash" }).click();
  await page.getByRole("button", { name: /Trash/ }).click();
  await expect(page.getByText("Tasks board")).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Tasks board");
});

test("installed app opens with no network", async ({ browser }) => {
  const ctx = await browser.newContext({ serviceWorkers: "allow" });
  const page = await ctx.newPage();
  await signIn(page, A);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // the worker now controls the page and has cached the shell
  await expect(page.getByRole("button", { name: "📅 Today" })).toBeVisible();
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "📅 Today" })).toBeVisible();
  await expect(page.locator(".ProseMirror")).toContainText("written offline");
  await ctx.close();
});

test("phone layout uses a drawer", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await signIn(page, A).catch(() => {}); // the sidebar is off-screen, so check by role below
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("button", { name: "📅 Today" })).toBeInViewport();
  await page.locator(".scrim").click({ position: { x: 380, y: 400 } });
  await expect(page.getByRole("button", { name: "📅 Today" })).not.toBeInViewport();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await ctx.close();
});

test("drag a block to reorder", async () => {
  const { page } = devA1;
  await page.getByRole("button", { name: "＋ New page" }).click();
  await page.getByLabel("Page title").fill("Order test");
  await page.locator(".ProseMirror p").first().click();
  await page.keyboard.type("alpha");
  await page.keyboard.press("Enter");
  await page.keyboard.type("beta");
  await page.keyboard.press("Enter");
  await page.keyboard.type("gamma");
  const gamma = page.locator(".ProseMirror p", { hasText: "gamma" });
  await gamma.hover();
  const grip = page.locator(".grip");
  await expect(grip).toBeVisible();
  const alpha = await page.locator(".ProseMirror p", { hasText: "alpha" }).boundingBox();
  await grip.dragTo(page.locator(".ProseMirror p", { hasText: "alpha" }), { targetPosition: { x: 20, y: 2 } });
  await expect(page.locator(".ProseMirror p")).toHaveText(["gamma", "alpha", "beta"]);
  expect(alpha).not.toBeNull();
});

test("drag a page onto another page in the sidebar", async () => {
  const { page } = devA1;
  const tree = page.getByRole("navigation", { name: "Pages" });
  await page.getByRole("button", { name: "＋ New page" }).click();
  await page.getByLabel("Page title").fill("Parent page");
  await page.getByRole("button", { name: "＋ New page" }).click();
  await page.getByLabel("Page title").fill("Child page");
  await tree.getByText("Child page").dragTo(tree.getByText("Parent page"));
  await tree.getByText("Parent page").click();
  await expect(tree.getByLabel("Collapse")).toBeVisible();
  await expect(tree.getByText("Child page")).toBeVisible();
});

test("database board: drag a card to another group", async () => {
  const { page } = devA1;
  await page.getByRole("button", { name: "▦ New database" }).click();
  await page.getByLabel("Page title").fill("Sprint");
  for (const [i, [name, status]] of [["Write docs", "todo"], ["Ship it", "done"]].entries()) {
    await page.getByRole("button", { name: "＋ New row" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(i + 1);
    const row = page.locator("tbody tr").last();
    await row.getByLabel("Row name").fill(name);
    await row.getByLabel("Status", { exact: true }).fill(status);
  }
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todo = page.getByRole("region", { name: "todo" });
  const done = page.getByRole("region", { name: "done" });
  await expect(todo.getByText("Write docs")).toBeVisible();
  await expect(done.getByText("Ship it")).toBeVisible();
  await todo.getByText("Write docs").dragTo(done);
  await expect(done.getByText("Write docs")).toBeVisible();
  await expect(todo.getByText("Write docs")).toHaveCount(0);
  // the change is stored on the row, so the table shows it too
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.locator("tbody tr").filter({ has: page.locator('input[value="Write docs"]') }).getByLabel("Status", { exact: true })).toHaveValue("done");
});
