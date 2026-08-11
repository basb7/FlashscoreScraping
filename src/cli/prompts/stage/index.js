import inquirer from "inquirer";
import chalk from "chalk";

export const selectStage = async (stage, rounds = []) => {
  if (stage && stage.toLowerCase() !== "todos") {
    console.info(`${chalk.green("✔")} Stage: ${chalk.cyan(stage)}`);
    return { value: stage };
  }

  const uniqueRounds = [...new Set(rounds.filter(Boolean))];
  const choices = ["Todos (all stages)", ...uniqueRounds, "Cancel"];
  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: "Select a stage:",
      choices,
    },
  ]);

  if (choice === "Cancel") {
    console.info("\nNo option selected. Exiting...\n");
    throw Error;
  }

  if (choice === "Todos (all stages)") return { value: "todos" };

  return { value: choice };
};