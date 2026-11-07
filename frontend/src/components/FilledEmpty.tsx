/** "filled / empty" pair used in stock tables (Dashboard live stock, Reports stock snapshot). */
export function FilledEmpty({ filled, empty }: { filled: number; empty: number }) {
  return (
    <>
      <span className="ui-num-strong">{filled}</span>
      <span className="ui-num-sep" aria-hidden="true">/</span>
      <span className="ui-num-muted">{empty}</span>
    </>
  );
}
