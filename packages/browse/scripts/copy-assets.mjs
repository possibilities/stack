import { cpSync } from "node:fs";
cpSync("resources", "dist/resources", { recursive: true });
