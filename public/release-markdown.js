(function initialiseReleaseMarkdown(globalScope) {
  function splitTableRow(line) {
    const source = String(line ?? "").trim();
    if (!source.includes("|")) return null;

    const cells = [];
    let cell = "";
    let inCode = false;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === "\\" && source[index + 1] === "|") {
        cell += "|";
        index += 1;
      } else if (character === "`") {
        inCode = !inCode;
        cell += character;
      } else if (character === "|" && !inCode) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += character;
      }
    }
    cells.push(cell.trim());
    if (!cells[0]) cells.shift();
    if (!cells.at(-1)) cells.pop();
    return cells.length > 1 ? cells : null;
  }

  function alignmentFor(cell) {
    if (!/^:?-{3,}:?$/.test(cell)) return null;
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    return "left";
  }

  function parseTable(lines, startIndex) {
    const headers = splitTableRow(lines[startIndex]);
    const separators = splitTableRow(lines[startIndex + 1]);
    if (!headers || !separators || headers.length !== separators.length) return null;
    const alignments = separators.map(alignmentFor);
    if (alignments.some((alignment) => !alignment)) return null;

    const rows = [];
    let nextIndex = startIndex + 2;
    while (nextIndex < lines.length) {
      const cells = splitTableRow(lines[nextIndex]);
      if (!cells || cells.length !== headers.length) break;
      rows.push(cells);
      nextIndex += 1;
    }
    return { headers, alignments, rows, nextIndex };
  }

  const api = { parseTable, splitTableRow };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalScope.ReleaseMarkdown = api;
})(typeof globalThis === "undefined" ? window : globalThis);
