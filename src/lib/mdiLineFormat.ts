/** Appends optional G-code comment (`; label`) for MDI history / preview. */
export function formatMdiLineWithComment(base: string, comment?: string): string {
  const label = comment?.trim();
  return label ? `${base} ; ${label}` : base;
}

export function formatSpindleMdiLine(rpm: number, comment?: string): string {
  return formatMdiLineWithComment(`S${rpm}`, comment);
}

export function formatFeedMdiLine(feedMmMin: number, comment?: string): string {
  return formatMdiLineWithComment(`F${feedMmMin}`, comment);
}
