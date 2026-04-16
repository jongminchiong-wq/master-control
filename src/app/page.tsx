export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-medium text-gray-800 mb-2">
          Master Control
        </h1>
        <p className="text-sm text-gray-500">
          B2B procurement platform for oil &amp; gas MRO consumables
        </p>
        <div className="mt-6 flex gap-3 justify-center">
          <span className="inline-block rounded-md bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-800">
            brand
          </span>
          <span className="inline-block rounded-md bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-800">
            purple
          </span>
          <span className="inline-block rounded-md bg-accent-50 px-3 py-1.5 text-xs font-medium text-accent-800">
            accent
          </span>
          <span className="inline-block rounded-md bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
            amber
          </span>
          <span className="inline-block rounded-md bg-danger-50 px-3 py-1.5 text-xs font-medium text-danger-800">
            danger
          </span>
          <span className="inline-block rounded-md bg-success-50 px-3 py-1.5 text-xs font-medium text-success-800">
            success
          </span>
        </div>
        <p className="mt-4 text-xs text-gray-400 font-mono">
          font-mono: IBM Plex Mono
        </p>
      </div>
    </main>
  );
}
