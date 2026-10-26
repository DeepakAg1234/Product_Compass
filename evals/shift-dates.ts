/**
 * Shift all dates in RavenStack Kaggle CSVs forward by 365 days.
 *
 * Input:  /tmp/kaggle-datasets/ravenstack/*.csv  (Jan 2023 - Dec 2024)
 * Output: evals/data/ravenstack/*.csv             (Jan 2024 - Dec 2025)
 *
 * Usage:
 *   deno run --allow-read --allow-write evals/shift-dates.ts
 */

import { parse, stringify } from "https://deno.land/std@0.224.0/csv/mod.ts";

const SHIFT_DAYS = 365;
const MS_PER_DAY = 86400000;

const INPUT_DIR = "/tmp/kaggle-datasets/ravenstack";
const OUTPUT_DIR = "./evals/data/ravenstack";

// Map of filename -> columns that contain dates
const DATE_COLUMNS: Record<string, string[]> = {
  "ravenstack_accounts.csv": ["signup_date"],
  "ravenstack_subscriptions.csv": ["start_date", "end_date"],
  "ravenstack_feature_usage.csv": ["usage_date"],
  "ravenstack_support_tickets.csv": ["submitted_at", "closed_at"],
  "ravenstack_churn_events.csv": ["churn_date"],
};

function shiftDate(value: string): string {
  if (!value || value.trim() === "") return value;

  // Handle datetime format: "2023-07-28 03:00:00"
  const hasTime = value.includes(" ");
  const datePart = hasTime ? value.split(" ")[0] : value;
  const timePart = hasTime ? value.split(" ")[1] : null;

  const d = new Date(datePart + "T00:00:00Z");
  if (isNaN(d.getTime())) return value; // not a valid date, return as-is

  const shifted = new Date(d.getTime() + SHIFT_DAYS * MS_PER_DAY);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");

  return timePart ? `${yyyy}-${mm}-${dd} ${timePart}` : `${yyyy}-${mm}-${dd}`;
}

async function processFile(filename: string, columns: string[]) {
  const inputPath = `${INPUT_DIR}/${filename}`;
  const outputPath = `${OUTPUT_DIR}/${filename}`;

  const raw = await Deno.readTextFile(inputPath);
  const records = parse(raw, { skipFirstRow: true }) as Record<string, string>[];
  const headers = Object.keys(records[0]);

  for (const record of records) {
    for (const col of columns) {
      if (col in record) {
        record[col] = shiftDate(record[col]);
      }
    }
  }

  const output = stringify(records, { columns: headers });
  await Deno.writeTextFile(outputPath, output);
  console.log(`${filename}: ${records.length} rows, shifted [${columns.join(", ")}]`);
}

// Main
console.log(`Shifting dates +${SHIFT_DAYS} days...`);
console.log(`Input:  ${INPUT_DIR}`);
console.log(`Output: ${OUTPUT_DIR}\n`);

for (const [filename, columns] of Object.entries(DATE_COLUMNS)) {
  await processFile(filename, columns);
}

console.log("\nDone. Shifted CSVs written to evals/data/ravenstack/");
