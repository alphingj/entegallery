"use client";

import { LibraryGrid } from "@/components/library-grid";
import { Nav } from "@/components/nav";

export default function HeicPage() {
  return (
    <>
      <Nav active="heic" />
      <main className="mx-auto w-full max-w-7xl flex-1 px-2 py-4 sm:px-4">
        <LibraryGrid heic="only" />
      </main>
    </>
  );
}