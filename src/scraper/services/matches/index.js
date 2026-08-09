import { openPageAndNavigate, waitForSelectorSafe } from "../../index.js";
import { MATCHES_LOAD_TIMEOUT } from "../../../constants/index.js";

export const getMatchLinks = async (context, leagueSeasonUrl, type) => {
  // Archive hrefs end with "/"; normalize before appending "/<type>"
  // to avoid a double slash that redirects to the live view.
  const seasonUrl = leagueSeasonUrl.replace(/\/+$/, "");
  const page = await openPageAndNavigate(context, `${seasonUrl}/${type}`);

  const LOAD_MORE_SELECTOR = '[data-testid="wcl-buttonLink"]';
  const MATCH_SELECTOR = ".event__match.event__match--twoLine";
  const CLICK_DELAY = 600;
  const MAX_EMPTY_CYCLES = 4;

  // Flashscore renders the match list lazily after domcontentloaded,
  // so wait for the rows to actually appear before counting them.
  try {
    await page.waitForSelector(MATCH_SELECTOR, { timeout: MATCHES_LOAD_TIMEOUT });
  } catch {}

  let emptyCycles = 0;

  while (true) {
    const countBefore = await page.$$eval(MATCH_SELECTOR, (els) => els.length);

    const loadMoreBtn = await page.$(LOAD_MORE_SELECTOR);
    if (!loadMoreBtn) break;

    try {
      await loadMoreBtn.click();
      await page.waitForTimeout(CLICK_DELAY);
    } catch {
      break;
    }

    const countAfter = await page.$$eval(MATCH_SELECTOR, (els) => els.length);

    if (countAfter === countBefore) {
      emptyCycles++;
      if (emptyCycles >= MAX_EMPTY_CYCLES) break;
    } else {
      emptyCycles = 0;
    }
  }

  // Archived seasons (URL ends with "-2025-2026") show the whole tournament
  // as consecutive .headerLeague blocks (e.g. Play Offs + League phase);
  // the current season (bare league URL) mixes the current tournament at the
  // top (e.g. Clausura) with finished ones below (e.g. Apertura).
  const isArchivedSeason = /-\d{4}(-\d{4})?$/.test(seasonUrl);

  const matchIdList = await page.evaluate(
    ({ onlyCurrentTournament, isArchivedSeason }) => {
      const MATCH_SELECTOR = ".event__match.event__match--twoLine";
      const ROUND_SELECTOR = ".event__round.event__round--static";

      const toMatch = (element) => ({
        id: element?.id?.replace("g_1_", ""),
        url: element.querySelector("a.eventRowLink")?.href ?? null,
      });

      const allMatches = () =>
        Array.from(document.querySelectorAll(MATCH_SELECTOR)).map(toMatch);

      if (!onlyCurrentTournament || isArchivedSeason) {
        return allMatches();
      }

      // Current season: each tournament is a .headerLeague block. Keep only
      // the first block, which is the running tournament.
      const firstLeague = document.querySelector(
        ".headerLeague__wrapper, .headerLeague"
      );

      if (!firstLeague) return allMatches();

      const matches = [];
      let node = firstLeague.nextElementSibling;
      while (node) {
        const cls =
          typeof node.className === "string"
            ? node.className
            : String(node.className || "");

        if (cls.includes("headerLeague")) break;
        if (cls.includes("event__match")) matches.push(toMatch(node));
        node = node.nextElementSibling;
      }

      return matches;
    },
    { onlyCurrentTournament: type === "results", isArchivedSeason }
  );

  await page.close();

  console.info(`✅ Found ${matchIdList.length} matches for ${type}`);
  return matchIdList;
};

const waitForAnyOf = async (page, selectors, timeout = MATCHES_LOAD_TIMEOUT) => {
  try {
    await page.waitForSelector(selectors.join(","), { timeout });
  } catch {}
};

export const getMatchData = async (context, { id: matchId, url }) => {
  const page = await openPageAndNavigate(context, url);

  // Wait for the page sections to actually render before extracting;
  // Flashscore hydrates header, match info and statistics lazily.
  await Promise.all([
    waitForAnyOf(page, [
      ".duelParticipant__startTime",
      "span[data-testid='wcl-scores-overline-03']",
    ]),
    waitForAnyOf(page, ["div[data-testid='wcl-summaryMatchInformation'] > div"]),
    waitForAnyOf(page, ["div[data-testid='wcl-statistics']"]),
  ]);

  const matchData = await extractMatchData(page);
  const information = await extractMatchInformation(page);
  const statistics = await extractMatchStatistics(page);

  await page.close();
  return { matchId, ...matchData, information, statistics };
};

const extractMatchData = async (page) => {
  await waitForSelectorSafe(page, [
    "span[data-testid='wcl-scores-overline-03']",
    ".duelParticipant__startTime",
    ".fixedHeaderDuel__detailStatus",
    ".tournamentHeader__country > a",
    ".detailScore__wrapper span:not(.detailScore__divider)",
    ".duelParticipant__home .participant__image",
    ".duelParticipant__away .participant__image",
    ".duelParticipant__home .participant__participantName.participant__overflow",
    ".duelParticipant__away .participant__participantName.participant__overflow",
  ]);

  return await page.evaluate(() => {
    return {
      stage: Array.from(
        document.querySelectorAll("span[data-testid='wcl-scores-overline-03']")
      )?.[2]
        ?.innerText.trim()
        ?.split(" - ")
        .pop()
        .trim(),
      date: document
        .querySelector(".duelParticipant__startTime")
        ?.innerText.trim(),
      status:
        document
          .querySelector(".fixedHeaderDuel__detailStatus")
          ?.innerText.trim() ?? "NOT STARTED",
      home: {
        name: document
          .querySelector(
            ".duelParticipant__home .participant__participantName.participant__overflow"
          )
          ?.innerText.trim(),
        image: document.querySelector(
          ".duelParticipant__home .participant__image"
        )?.src,
      },
      away: {
        name: document
          .querySelector(
            ".duelParticipant__away .participant__participantName.participant__overflow"
          )
          ?.innerText.trim(),
        image: document.querySelector(
          ".duelParticipant__away .participant__image"
        )?.src,
      },
      result: {
        home: Array.from(
          document.querySelectorAll(
            ".detailScore__wrapper span:not(.detailScore__divider)"
          )
        )?.[0]?.innerText.trim(),
        away: Array.from(
          document.querySelectorAll(
            ".detailScore__wrapper span:not(.detailScore__divider)"
          )
        )?.[1]?.innerText.trim(),
        regulationTime: document
          .querySelector(".detailScore__fullTime")
          ?.innerText.trim()
          .replace(/[\n()]/g, ""),
        penalties: Array.from(
          document.querySelectorAll('[data-testid="wcl-scores-overline-02"]')
        )
          .find(
            (element) => element.innerText.trim().toLowerCase() === "penalties"
          )
          ?.nextElementSibling?.innerText?.trim()
          .replace(/\s+/g, ""),
      },
    };
  });
};

const extractMatchInformation = async (page) => {
  return await page.evaluate(async () => {
    const elements = Array.from(
      document.querySelectorAll(
        "div[data-testid='wcl-summaryMatchInformation'] > div"
      )
    );
    return elements.reduce((acc, element, index) => {
      if (index % 2 === 0) {
        acc.push({
          category: element?.textContent
            .trim()
            .replace(/\s+/g, " ")
            .replace(/(^[:\s]+|[:\s]+$|:)/g, ""),
          value: elements[index + 1]?.innerText
            .trim()
            .replace(/\s+/g, " ")
            .replace(/(^[:\s]+|[:\s]+$|:)/g, ""),
        });
      }
      return acc;
    }, []);
  });
};

const extractMatchStatistics = async (page) => {
  return await page.evaluate(async () => {
    return Array.from(
      document.querySelectorAll("div[data-testid='wcl-statistics']")
    ).map((element) => {
      const values = Array.from(
        element.querySelectorAll("div[data-testid='wcl-statistics-value']")
      );
      return {
        category: element
          .querySelector("div[data-testid='wcl-statistics-category']")
          ?.innerText.trim(),
        homeValue: values[0]?.innerText.trim(),
        awayValue: values[1]?.innerText.trim(),
      };
    });
  });
};
