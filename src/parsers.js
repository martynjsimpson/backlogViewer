const YAML = require("yaml");
const {
  REQUEST_FIELDS,
  REQUEST_SECTIONS,
  SUPPORTED_BACKLOG_MODEL_VERSION,
} = require("./constants");

function keyToProperty(key) {
  return String(key).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function splitOutsideParentheses(value) {
  const values = [];
  let depth = 0;
  let current = "";
  for (const character of String(value || "")) {
    if (character === "(") depth += 1;
    if (character === ")" && depth > 0) depth -= 1;
    if (character === "," && depth === 0) {
      if (current.trim()) values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) values.push(current.trim());
  return values;
}

function parseCompletionValues(value, ids) {
  if (value && typeof value === "object") {
    return [{
      kind: "invalid",
      raw: YAML.stringify(value, { lineWidth: 0 }).trim(),
      value,
      non_scalar: true,
    }];
  }
  return splitOutsideParentheses(value).map((raw) => {
    const spikeMatch = raw.match(new RegExp(`^SPIKE:\\s*(${ids.workPrefix}-\\d+[A-Z]?)$`, "i"));
    if (spikeMatch) return { kind: "spike", raw, value: spikeMatch[1].toUpperCase() };
    const versionMatch = raw.match(/^(v?\d+(?:\.\d+){1,2}|\d{4}\.\d{2}\.\d{2})(?:\s*\((.+)\))?$/i);
    if (versionMatch) {
      return { kind: "release", raw, value: versionMatch[1], annotation: versionMatch[2] || "" };
    }
    return { kind: "invalid", raw, value: raw };
  });
}

function parseReleaseDates(markdown) {
  const dates = {};
  const heading = /^#{1,6}\s+\[?(v?\d+(?:\.\d+){2})\]?\s*(?:[-–—:]\s*|\(\s*)(\d{4}-\d{2}-\d{2})\)?(?:\s|$)/i;
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const match = line.match(heading);
    if (!match) continue;
    const version = match[1].replace(/^v/i, "");
    dates[version] ||= match[2];
  }
  return dates;
}

function parseWorkItemReferences(value, ids) {
  const text = String(value || "").trim();
  const references = splitOutsideParentheses(text).flatMap((part) => {
    const match = part.trim().match(new RegExp(`^(${ids.workPrefix}-\\d+[A-Z]?)\\b`, "i"));
    return match ? [match[1].toUpperCase()] : [];
  });
  return {
    references: [...new Set(references)],
    explicitlyNone: /^none\b/i.test(text),
    raw: text,
  };
}

function parseRequests(markdown, ids) {
  const lines = markdown.split(/\r?\n/);
  const requests = [];
  const sections = [];
  let section = "";
  let current = null;
  let lastKey = null;
  let activeFence = null;

  function finishCurrent() {
    if (!current) return;
    const workItems = parseWorkItemReferences(current.work_items_raw, ids);
    current.work_items = workItems.references;
    current.work_items_explicitly_none = workItems.explicitlyNone;
    current.done_in = parseCompletionValues(current.done_in_raw, ids);
    current.source_block = current._rawLines.join("\n").trim();
    delete current._rawLines;
    requests.push(current);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMarker = line.match(/^\s*(`{3,}|~{3,})/);
    if (activeFence) {
      if (current) current._rawLines.push(line);
      if (
        fenceMarker
        && fenceMarker[1][0] === activeFence.character
        && fenceMarker[1].length >= activeFence.length
        && !line.slice(fenceMarker[0].length).trim()
      ) activeFence = null;
      continue;
    }
    if (fenceMarker) {
      if (current) current._rawLines.push(line);
      activeFence = { character: fenceMarker[1][0], length: fenceMarker[1].length };
      continue;
    }
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      sections.push({ title: section, line: index + 1 });
      continue;
    }

    const requestHeading = line.match(/^###\s+([^\s]+)(?:\s+.*)?$/);
    if (requestHeading && ids.requestPattern.test(requestHeading[1])) {
      finishCurrent();
      current = {
        id: requestHeading[1].toUpperCase(),
        section,
        line: index + 1,
        unknown_fields: [],
        _rawLines: [line],
      };
      lastKey = null;
      continue;
    }

    if (!current) continue;
    current._rawLines.push(line);

    const fieldMatch = line.match(/^([A-Za-z][A-Za-z ]+):\s*(.*)$/);
    if (fieldMatch) {
      const inputName = fieldMatch[1].trim();
      const property = REQUEST_FIELDS.get(inputName.toLowerCase());
      if (property) {
        current[property] = fieldMatch[2].trim();
        lastKey = property;
      } else {
        const unknown = { name: inputName, value: fieldMatch[2].trim(), line: index + 1 };
        current.unknown_fields.push(unknown);
        current[keyToProperty(inputName)] = unknown.value;
        lastKey = null;
      }
      continue;
    }

    if (lastKey && line.trim() && !line.startsWith("#") && !/^---+$/.test(line.trim())) {
      current[lastKey] = `${current[lastKey]} ${line.trim()}`.trim();
    }
  }
  finishCurrent();

  return {
    items: requests,
    metadata: {
      sections,
      expectedSections: REQUEST_SECTIONS,
    },
  };
}

function ensureArray(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function normaliseBacklogItem(item, ids) {
  const normalized = { ...item };
  for (const key of ["acceptance", "dependencies", "suggested_agents", "done_in"]) {
    normalized[key] = ensureArray(normalized[key]);
  }
  normalized.id = String(normalized.id || "").toUpperCase();
  normalized.source_request = normalized.source_request == null ? "" : String(normalized.source_request).toUpperCase();
  normalized.done_in = normalized.done_in.flatMap((value) => parseCompletionValues(value, ids));
  normalized.source_block = YAML.stringify(item, { lineWidth: 0 }).trim();
  return normalized;
}

function parseBacklog(source, ids) {
  const document = YAML.parseDocument(source, { prettyErrors: true });
  if (document.errors.length) throw document.errors[0];
  const data = document.toJS() || {};
  if (!Array.isArray(data.items)) throw new Error("backlog.yml must contain an items list");
  return {
    modelVersion: data.model_version,
    supportedModelVersion: SUPPORTED_BACKLOG_MODEL_VERSION,
    items: data.items.map((item) => normaliseBacklogItem(item || {}, ids)).filter((item) => item.id),
  };
}

function sectionSlug(value) {
  return keyToProperty(value);
}

function parseActiveRelease(markdown, ids) {
  const release = {
    version: "",
    branch: "",
    status: "none",
    release_goal: "",
    work_items: [],
    request_ids: [],
    sections: {},
    source_block: markdown.trim(),
  };
  let currentSection = "overview";
  let currentItem = null;
  let lastTopField = null;
  release.sections.overview = [];

  for (const line of markdown.split(/\r?\n/)) {
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      currentSection = sectionSlug(sectionMatch[1]);
      release.sections[currentSection] = [];
      currentItem = null;
      lastTopField = null;
      continue;
    }

    const itemMatch = line.match(new RegExp(`^###\\s+(${ids.workPrefix}-\\d+[A-Z]?)\\s+[-–—]\\s+(.+)$`, "i"));
    if (itemMatch) {
      currentItem = { id: itemMatch[1].toUpperCase(), title: itemMatch[2].trim(), description_lines: [] };
      release.work_items.push(currentItem);
      release.sections[currentSection].push(line);
      continue;
    }

    if (currentItem) {
      const pipeFields = line.split("|").map((part) => part.trim());
      let matchedField = false;
      for (const part of pipeFields) {
        const match = part.match(/^([A-Za-z ]+):\s*(.+)$/);
        if (!match) continue;
        const key = keyToProperty(match[1]);
        currentItem[key] = match[2].trim();
        matchedField = true;
      }
      if (!matchedField && line.trim() && !/^---+$/.test(line.trim())) currentItem.description_lines.push(line.trim());
    }

    if (currentSection === "overview") {
      const topField = line.match(/^(Version|Branch|Status|Release goal):\s*(.*)$/i);
      if (topField) {
        lastTopField = keyToProperty(topField[1]);
        release[lastTopField] = topField[2].trim();
      } else if (lastTopField === "release_goal" && line.trim() && !/^---+$/.test(line.trim())) {
        release.release_goal = `${release.release_goal} ${line.trim()}`.trim();
      }
    }
    release.sections[currentSection].push(line);
  }

  for (const item of release.work_items) {
    item.description = item.description_lines.join(" ");
    delete item.description_lines;
    if (item.source && ids.requestPattern.test(item.source)) release.request_ids.push(item.source.toUpperCase());
  }
  release.request_ids = [...new Set(release.request_ids)];
  release.section_text = Object.fromEntries(Object.entries(release.sections).map(([key, lines]) => [key, lines.join("\n").trim()]));
  delete release.sections;
  return release;
}

module.exports = {
  parseActiveRelease,
  parseBacklog,
  parseCompletionValues,
  parseReleaseDates,
  parseRequests,
  parseWorkItemReferences,
  splitOutsideParentheses,
};
