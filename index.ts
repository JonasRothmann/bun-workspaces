#!/usr/bin/env bun

import { Command } from "commander";
import { readdir } from "node:fs/promises";

const program = new Command();

const path = "./package.json";
const file = Bun.file(path);

let workspaces: string[];
try {
  const text = await file.text();
  const json = JSON.parse(text);
  workspaces = json.workspaces;
  if (!workspaces) {
    throw new Error("No workspaces found in package.json");
  }
} catch (error) {
  console.error(error);
  throw new Error("Could not read package.json");
}

const packages = (
  await Promise.all(
    workspaces
      .map((workspace) => "./" + workspace.replace("/*", ""))
      .map(async (workspace) => {
        const dir = await readdir(workspace, { withFileTypes: true });

        const dirs = await Promise.all(
          dir.map(async (dir) => {
            if (dir.isDirectory()) {
              try {
                const rootPath = `${workspace}/${dir.name}`;
                const path = `${workspace}/${dir.name}/package.json`;
                const file = Bun.file(path);
                const text = await file.text();
                const json = JSON.parse(text);
                return { path: rootPath, name: json.name };
              } catch (error) {
                //console.error(error);
              }
            }
          })
        );

        return dirs.filter(Boolean) as { path: string; name: string }[];
      })
  )
).flat();

program
  .option("--filter <type>", "a filter option")
  .arguments("<cmd> [args...]")
  .action(async (cmd, args, options) => {
    const filterName = program.opts().filter;
    const filter = packages.find((p) => p.name === filterName);
    const bunCommand = ["bun", cmd, ...args];
    const filteredDependencies: Record<string, string> = {};

    if (filterName) {
      if (!filter) {
        console.error(`Package ${filterName} not found`);
        return;
      }

      const packageJson = await Bun.file(filter.path + "/package.json").json();
      bunCommand.splice(1, 0, `--cwd=${filter.path}`);

      const dependencies: Record<string, string> = packageJson.dependencies;

      packageJson.dependencies = Object.fromEntries(
        Object.entries(dependencies).filter(([key, value]) => {
          if (packages.find((p) => p.name === key)) {
            filteredDependencies[key] = value;
            return false;
          }
          return true;
        })
      );

      await Bun.write(
        filter.path + "/package.json",
        JSON.stringify(packageJson, null, 2)
      );
    }

    Bun.spawn(bunCommand, {
      stdout: "inherit",
      async onExit(proc, exitCode, signalCode, error) {
        if (error) {
          console.error("Error:", error);
          return;
        }

        if (filter) {
          const packageJson = await Bun.file(
            filter.path + "/package.json"
          ).json();

          packageJson.dependencies = {
            ...packageJson.dependencies,
            ...filteredDependencies,
          };

          await Bun.write(
            filter.path + "/package.json",
            JSON.stringify(packageJson, null, 2)
          );
        }
      },
    });
  });

program.parse(process.argv);

const removeTrailingComma = (line: string) => {
  return line.replace(/,\s*$/, "");
};
