import inquirer from "inquirer";

import { getListOfSeasons } from "../../../scraper/services/seasons/index.js";

import { start, stop } from "../../loader/index.js";

export const selectSeason = async (context, leagueUrl) => {
  start();
  const seasons = await getListOfSeasons(context, leagueUrl);
  stop();
  const options = seasons.map((season) => season.name);

  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: "Select a league season:",
      choices: [...options, "Cancel", new inquirer.Separator()],
    },
  ]);

  if (choice === "Cancel") {
    console.info("\nNo option selected. Exiting...\n");
    throw Error;
  }

  const season = seasons.find((season) => season.name === choice);

  if (!season?.url) {
    console.info("\n⚠️ No valid season URL found. Exiting...\n");
    throw Error(
      `❌ Could not resolve a valid URL for season "${choice}"\n` +
        `The archive page structure may have changed`
    );
  }

  return season;
};
