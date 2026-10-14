// The unread comment count in every admin page's nav (#10, Alex's condition b). Kept free
// of imports so tests/unit/comment.test.ts can load it (C13–C15).
//
// It works by replacing the nav's Comments link, exactly as ui.ts renders it. If that
// markup changed, the replace would find nothing and the count would silently vanish —
// C13 reads ui.ts and fails first.
export const COMMENTS_LINK = `<a href="/admin/comments">Comments</a>`;

// `unread` is null when the count could not be read: said, never dropped.
export function navWithUnread(html: string, unread: number | null): string {
  const label =
    unread === null ? "Comments (count failed)" : unread > 0 ? `<strong>Comments (${unread} unread)</strong>` : "Comments (0 unread)";
  return html.replace(COMMENTS_LINK, `<a href="/admin/comments">${label}</a>`);
}
