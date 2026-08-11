import { chromium } from "playwright";
import pLimit from "p-limit";
import chalk from "chalk";

import { OUTPUT_PATH } from "./constants/index.js";
import { parseArguments } from "./cli/arguments/index.js";
import { promptUserOptions } from "./cli/prompts/index.js";
import { selectStage } from "./cli/prompts/stage/index.js";
import { start, stop } from "./cli/loader/index.js";
import { initializeProgressbar } from "./cli/progressbar/index.js";

import {
  getMatchLinks,
  getMatchData,
} from "./scraper/services/matches/index.js";

import { writeDataToFile } from "./files/handle/index.js";

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const withRetry = async (fn, retries = 3) => {
  try {
    return await fn();
  } catch (err) {
    if (retries === 0) throw err;
    const delay = (4 - retries) * 500;
    console.warn(`⚠️ Retry in ${delay}ms...`);
    await sleep(delay);
    return withRetry(fn, retries - 1);
  }
};

(async () => {
  let browser;
  let context;

  try {
    const cliOptions = parseArguments();

    browser = await chromium.launch({ headless: cliOptions.headless });
    context = await browser.newContext();

    const { fileName, season, fileType } = await promptUserOptions(
      context,
      cliOptions
    );

    start();

    const matchLinksResults = await getMatchLinks(
      context,
      season?.url,
      "results"
    );
    const matchLinksFixtures = await getMatchLinks(
      context,
      season?.url,
      "fixtures"
    );
    const matchLinks = [...matchLinksFixtures, ...matchLinksResults];

    if (matchLinks.length === 0) {
      throw Error(
        `❌ No matches found on the results and fixtures pages\n` +
          `Please verify that the league name provided is correct\n` +
          `and that the chosen season actually has matches`
      );
    }

    stop();

    const rounds = [...new Set(matchLinks.map((m) => m.round).filter(Boolean))];

    const stageSelection = await selectStage(cliOptions.stage, rounds);

    const isStageFiltered = stageSelection.value !== "todos";
    let filteredMatchLinks = matchLinks;
    if (isStageFiltered) {
      filteredMatchLinks = matchLinks.filter(
        (m) => (m.round ?? "") === stageSelection.value
      );
    }

    if (filteredMatchLinks.length === 0) {
      throw Error(
        isStageFiltered
          ? `❌ No matches found for stage "${stageSelection.value}"\n` +
              `Available stages: ${rounds.join(", ") || "none"}`
          : `❌ No matches found on the results and fixtures pages\n` +
              `Please verify that the league name provided is correct\n` +
              `and that the chosen season actually has matches`
      );
    }

    const outputFileName = isStageFiltered
      ? `${fileName}_${stageSelection.value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")}`
      : fileName;

    console.info(
      `🎯 Stage filter: ${
        isStageFiltered ? stageSelection.value : "todos"
      } (${filteredMatchLinks.length} matches)`
    );

    const progressbar = initializeProgressbar(filteredMatchLinks.length);
    const limit = pLimit(cliOptions.concurrency);

    const matchData = {};
    let processedCount = 0;

    const tasks = filteredMatchLinks.map((matchLink) =>
      limit(async () => {
        const data = await withRetry(() => getMatchData(context, matchLink));
        matchData[matchLink.id] = data;

        processedCount += 1;
        if (processedCount % cliOptions.saveInterval === 0) {
          writeDataToFile(matchData, outputFileName, fileType);
        }

        progressbar.increment();
      })
    );

    await Promise.all(tasks);

    progressbar.stop();
    writeDataToFile(matchData, outputFileName, fileType);

    console.info("\n✅ Data collection and file writing completed!");
    console.info(
      `📁 File saved to: ${chalk.cyan(
        `${OUTPUT_PATH}/${outputFileName}${fileType.extension}`
      )}\n`
    );
  } catch (error) {
    stop();
    if (error.message) console.error(`\n${error.message}\n`);
  } finally {
    await context?.close();
    await browser?.close();
  }
})();
