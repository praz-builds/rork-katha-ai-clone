export function parseGeneratedStoryText(
  text: string,
  fallbackTitle: string,
): { title: string; content: string } {
  const lines = text.split("\n");
  const titleIndex = lines.findIndex((line) => line.trim());
  if (titleIndex === -1) return { title: fallbackTitle, content: "" };

  const title = lines[titleIndex].replace(/^#\s*/, "").trim() || fallbackTitle;
  return {
    title,
    content: lines.slice(titleIndex + 1).join("\n").trim(),
  };
}
