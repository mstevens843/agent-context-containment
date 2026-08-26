// Print the imported-case mapping audit, for every imported dataset. See
// packages/conformance/src/mapping.ts for what the two numbers mean and why they are read together.
import { readFileSync } from "node:fs";
import { formatSensitivity, loadSplit, sensitivity } from "../packages/conformance/dist/index.js";

const HERE = new URL("../corpus/imported/", import.meta.url).pathname;
const imported = loadSplit(HERE, "imported");

// Reported PER DATASET, never merged. The direct-harm rows name one attacker tool and the harm is the
// call; the data-stealing rows name a pair - read, then send - and the harm is what leaves. One table
// over both would let 34 cases read as 34 independent attacks when they are two shapes.
for (const [file, label] of [
  ["MAPPING.json", "InjecAgent direct harm (one attacker tool)"],
  ["MAPPING_DS.json", "InjecAgent data stealing (read, then send)"],
]) {
  const m = JSON.parse(readFileSync(`${HERE}${file}`, "utf8"));
  console.log(`\n${label}  -  ${m.cases.length} cases`);
  console.log(
    formatSensitivity(
      m.cases.map((x) =>
        sensitivity(
          x,
          imported.find((c) => c.id === x.id),
        ),
      ),
    ),
  );
}
