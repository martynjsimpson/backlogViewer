(function healthExportModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HealthExport = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const severityOrder = ["error", "warning", "recommendation"];
  const findingFieldOrder = [
    "severity",
    "code",
    "title",
    "entity_type",
    "entity_id",
    "message",
    "meaning",
    "action_type",
    "recommended_action",
    "command",
  ];

  function valueSet(values) {
    return values instanceof Set ? values : new Set(values || []);
  }

  function filterHealthFindings(findings, severities, codes) {
    const selectedSeverities = valueSet(severities);
    const selectedCodes = valueSet(codes);
    return (findings || []).filter((finding) => (
      selectedSeverities.has(finding.severity)
      && (!selectedCodes.size || selectedCodes.has(finding.code))
    ));
  }

  function orderedValues(values, preferred = []) {
    const selected = valueSet(values);
    return [
      ...preferred.filter((value) => selected.has(value)),
      ...[...selected].filter((value) => !preferred.includes(value)).sort(),
    ];
  }

  function orderedFinding(finding) {
    return [...new Set([...findingFieldOrder, ...Object.keys(finding).sort()])]
      .filter((key) => Object.prototype.hasOwnProperty.call(finding, key))
      .filter((key) => finding[key] !== undefined)
      .reduce((result, key) => ({ ...result, [key]: finding[key] }), {});
  }

  function createHealthExport(data, findings, filters, generatedAt = new Date().toISOString()) {
    const severities = orderedValues(filters.severities, severityOrder);
    const codes = orderedValues(filters.codes);
    return {
      export_version: 1,
      kind: "backlog-viewer-health-findings",
      generated_at: generatedAt,
      model_generated_at: data.generated_at,
      project: {
        name: data.project.name,
        root: data.project.root,
      },
      filters: {
        severities,
        code_mode: codes.length ? "selected" : "all",
        codes,
      },
      shown_count: findings.length,
      total_finding_count: data.health.findings.length,
      source_files: { ...data.files },
      findings: findings.map(orderedFinding),
    };
  }

  function yamlKey(value) {
    return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value) ? value : JSON.stringify(value);
  }

  function yamlScalar(value) {
    if (value === null || value === undefined) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return JSON.stringify(String(value));
  }

  function emptyCollection(value) {
    if (Array.isArray(value) && !value.length) return "[]";
    if (value && typeof value === "object" && !Object.keys(value).length) return "{}";
    return null;
  }

  function yamlLines(value, indent = 0) {
    const spacing = " ".repeat(indent);
    if (Array.isArray(value)) {
      if (!value.length) return [`${spacing}[]`];
      const lines = [];
      for (const item of value) {
        if (item === null || typeof item !== "object") {
          lines.push(`${spacing}- ${yamlScalar(item)}`);
          continue;
        }
        const inline = emptyCollection(item);
        if (inline) {
          lines.push(`${spacing}- ${inline}`);
          continue;
        }
        const child = yamlLines(item, indent + 2);
        lines.push(`${spacing}- ${child[0].slice(indent + 2)}`, ...child.slice(1));
      }
      return lines;
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
      if (!entries.length) return [`${spacing}{}`];
      const lines = [];
      for (const [key, entry] of entries) {
        if (entry === null || typeof entry !== "object") {
          lines.push(`${spacing}${yamlKey(key)}: ${yamlScalar(entry)}`);
          continue;
        }
        const inline = emptyCollection(entry);
        if (inline) {
          lines.push(`${spacing}${yamlKey(key)}: ${inline}`);
          continue;
        }
        lines.push(`${spacing}${yamlKey(key)}:`, ...yamlLines(entry, indent + 2));
      }
      return lines;
    }
    return [`${spacing}${yamlScalar(value)}`];
  }

  function stringifyHealthExport(data, findings, filters, generatedAt) {
    return `${yamlLines(createHealthExport(data, findings, filters, generatedAt)).join("\n")}\n`;
  }

  function exportFilename(projectName, generatedAt = new Date().toISOString()) {
    const slug = String(projectName || "project")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project";
    const stamp = new Date(generatedAt).toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z")
      .replace("T", "-");
    return `health-findings-${slug}-${stamp}.yml`;
  }

  return {
    createHealthExport,
    exportFilename,
    filterHealthFindings,
    stringifyHealthExport,
  };
}));
