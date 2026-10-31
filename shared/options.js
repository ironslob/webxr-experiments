export function readOptions(defaults) {
  const params = new URLSearchParams(window.location.search);
  const options = { ...defaults };

  for (const [key, fallback] of Object.entries(defaults)) {
    const raw = params.get(key);
    if (raw == null || raw === "") continue;

    if (typeof fallback === "boolean") {
      options[key] = raw === "1" || raw === "true";
    } else if (typeof fallback === "number") {
      const value = Number(raw);
      if (Number.isFinite(value)) options[key] = value;
    } else {
      options[key] = raw;
    }
  }

  return options;
}
