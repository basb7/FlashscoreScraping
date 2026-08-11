import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("https://www.flashscore.com/football/colombia/primera-a/results/", { waitUntil: "domcontentloaded", timeout: 30000 });
try { await page.waitForSelector(".event__match.event__match--twoLine", { timeout: 10000 }); } catch {}

const dump = await page.evaluate(() => {
  const cls = (el) => (typeof el.className === "string" ? el.className : String(el.className || "")).slice(0, 80);
  const roundEls = document.querySelectorAll("[class*='event__round'], [class*='roundHeader'], [data-testid*='round'], [class*='event__header'], [class*='event__title']");
  const rounds = Array.from(roundEls).slice(0, 12).map((el) => ({ tag: el.tagName, cls: cls(el), text: el.innerText?.trim().slice(0, 50) }));
  const m = document.querySelector(".event__match.event__match--twoLine");
  let chain = [];
  let cur = m;
  for (let i = 0; i < 6 && cur; i++) { chain.push(`${cur.tagName}.${cls(cur)}`); cur = cur.parentElement; }
  const siblings = [];
  let prev = m?.previousElementSibling;
  for (let i = 0; i < 4 && prev; i++) { siblings.push(`${prev.tagName}.${cls(prev)} :: ${prev.innerText?.trim().slice(0, 50)}`); prev = prev.previousElementSibling; }
  return { rounds, chain, siblings };
});
console.log(JSON.stringify(dump, null, 2));
await browser.close();
