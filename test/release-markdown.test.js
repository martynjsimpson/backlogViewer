const assert = require("node:assert/strict");
const test = require("node:test");
const { parseTable, splitTableRow } = require("../public/release-markdown");

test("parses Markdown release tables and their column alignment", () => {
  const lines = [
    "| Agent | Needed for | Score |",
    "|:---|---|---:|",
    "| `frontend-developer` | WORK-146 | 2 |",
    "| `principal-architect` | WORK-144 | 1 |",
    "",
  ];

  assert.deepEqual(parseTable(lines, 0), {
    headers: ["Agent", "Needed for", "Score"],
    alignments: ["left", "left", "right"],
    rows: [
      ["`frontend-developer`", "WORK-146", "2"],
      ["`principal-architect`", "WORK-144", "1"],
    ],
    nextIndex: 4,
  });
});

test("does not confuse prose containing pipes with a Markdown table", () => {
  assert.equal(parseTable(["Type: docs | Priority: low", "The next prose line."], 0), null);
  assert.deepEqual(splitTableRow("| `npm run a|b` | escaped \\| pipe |"), ["`npm run a|b`", "escaped | pipe"]);
  assert.deepEqual(splitTableRow("| Platform | C:\\temp |"), ["Platform", "C:\\temp"]);
});
