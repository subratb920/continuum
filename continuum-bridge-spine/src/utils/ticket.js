export function extractTicketKey(url) {
  if (!url) return null;

  try {
    const u = new URL(url);

    // GitHub: /issues/123
    if (u.hostname.includes("github.com")) {
      const match = u.pathname.match(/issues\/(\d+)/);
      if (match) return `GH-${match[1]}`;
    }

    // Jira: /browse/PROJ-123
    const jiraMatch = u.pathname.match(/browse\/([A-Z]+-\d+)/);
    if (jiraMatch) return jiraMatch[1];

    // fallback
    return url;
  } catch {
    return url;
  }
}