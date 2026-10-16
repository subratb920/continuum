/**
 * Licences in plain words (spec 9.2): what a learner may do with the data.
 * commercial / attribution: true, false, or null when it depends.
 */
const KNOWN = {
  "cc0-1.0": { name: "CC0 (public domain)", commercial: true, attribution: false, plain: "Free for anything, no credit needed." },
  mit: { name: "MIT", commercial: true, attribution: true, plain: "Free for anything if you keep the author's notice." },
  "apache-2.0": { name: "Apache 2.0", commercial: true, attribution: true, plain: "Free for anything if you credit the author." },
  "cc-by-4.0": { name: "CC BY 4.0", commercial: true, attribution: true, plain: "Free for anything if you credit the author." },
  "cc-by-3.0": { name: "CC BY 3.0", commercial: true, attribution: true, plain: "Free for anything if you credit the author." },
  "cc-by-sa-3.0": { name: "CC BY-SA 3.0", commercial: true, attribution: true, plain: "Free for anything if you credit the author and share what you make under the same licence." },
  "cc-by-sa-4.0": { name: "CC BY-SA 4.0", commercial: true, attribution: true, plain: "Free for anything if you credit the author and share what you make under the same licence." },
  "cc-by-nc-4.0": { name: "CC BY-NC 4.0", commercial: false, attribution: true, plain: "Free for learning and personal projects, not for making money. Credit the author." },
  "cc-by-nc-sa-4.0": { name: "CC BY-NC-SA 4.0", commercial: false, attribution: true, plain: "Not for making money; credit the author and share alike." },
  odbl: { name: "ODbL", commercial: true, attribution: true, plain: "Free for anything if you credit the source and share changes to the data." },
  "odc-by": { name: "ODC-By", commercial: true, attribution: true, plain: "Free for anything if you credit the source." },
  "bsd-3-clause": { name: "BSD 3-Clause", commercial: true, attribution: true, plain: "Free for anything if you keep the author's notice." },
  gfdl: { name: "GNU FDL", commercial: true, attribution: true, plain: "Free to use if you credit the authors and share what you make under the same licence." },
  openrail: { name: "OpenRAIL", commercial: null, attribution: true, plain: "Free to use with some limits on harmful uses; read the licence." },
  other: { name: "Other", commercial: null, attribution: null, plain: "A licence of its own; read the dataset's page before you use it." },
  unknown: { name: "Unknown", commercial: null, attribution: null, plain: "No licence given. Fine for learning; ask the author before sharing what you make." },
};

export function licenceInfo(id) {
  const spdx = String(id || "unknown").toLowerCase();
  const known = KNOWN[spdx] ?? KNOWN.other;
  return { spdx, ...known };
}
