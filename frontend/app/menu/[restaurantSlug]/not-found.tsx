/**
 * Unknown and suspended restaurants look the same here, matching the API's
 * single 404 - the page does not reveal which one it was.
 */
export default function PublicMenuNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-ground px-4 py-10">
      <div className="max-w-sm text-center">
        <p className="text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase">Menu</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">This menu isn’t available</h1>
        <p className="mt-2 text-sm text-muted">
          The link may be mistyped, or the restaurant may not be taking customers right now. Please check with
          a member of staff.
        </p>
      </div>
    </main>
  );
}
