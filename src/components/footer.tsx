import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-12 flex flex-wrap justify-end gap-x-6 gap-y-2 border-t border-gray-200 pt-12 pb-6">
      <Link
        href="/legal/privacy"
        className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-700"
      >
        Privacy Notice
      </Link>
      <Link
        href="/legal/disclosures"
        className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-700"
      >
        Disclosures
      </Link>
    </footer>
  );
}
