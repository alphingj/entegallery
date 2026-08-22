"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BadgeCheck, FileImage, Images, Menu, Search, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UploadSheet } from "@/components/upload-sheet";
import { LibraryDialog } from "@/components/library-dialog";
import { cn } from "@/lib/utils";

export function Nav({
  active,
}: {
  active: "photos" | "heic" | "people" | "verify";
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-12 max-w-7xl items-center gap-2 px-3 sm:h-14 sm:gap-4 sm:px-4">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 sm:hidden"
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[min(82vw,300px)] sm:max-w-sm">
            <SheetHeader>
              <SheetTitle>Ente Gallery</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 p-4">
              <Button
                asChild
                variant="ghost"
                className={cn("justify-start min-h-11", active === "photos" && "bg-secondary")}
                onClick={() => setMenuOpen(false)}
              >
                <Link href="/"><Images className="size-4" /> Photos</Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                className={cn("justify-start min-h-11", active === "heic" && "bg-secondary")}
                onClick={() => setMenuOpen(false)}
              >
                <Link href="/heic"><FileImage className="size-4" /> HEIC</Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                className={cn("justify-start min-h-11", active === "people" && "bg-secondary")}
                onClick={() => setMenuOpen(false)}
              >
                <Link href="/people"><Users className="size-4" /> People</Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                className={cn("justify-start min-h-11", active === "verify" && "bg-secondary")}
                onClick={() => setMenuOpen(false)}
              >
                <Link href="/verify"><BadgeCheck className="size-4" /> Verify</Link>
              </Button>
            </nav>
          </SheetContent>
        </Sheet>

        <Link href="/" className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground text-sm">
            E
          </span>
          <span className="truncate">Ente Gallery</span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className={cn("min-h-9", active === "photos" && "bg-secondary")}
          >
            <Link href="/"><Images className="size-4" /> Photos</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className={cn("min-h-9", active === "heic" && "bg-secondary")}
          >
            <Link href="/heic"><FileImage className="size-4" /> HEIC</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className={cn("min-h-9", active === "people" && "bg-secondary")}
          >
            <Link href="/people"><Users className="size-4" /> People</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className={cn("min-h-9", active === "verify" && "bg-secondary")}
          >
            <Link href="/verify"><BadgeCheck className="size-4" /> Verify</Link>
          </Button>
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          {/* Desktop search */}
          <form
            className="hidden w-full max-w-[38vw] flex-1 sm:flex sm:max-w-xs"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people…"
              aria-label="Search people"
              className="min-h-9"
            />
          </form>

          {/* Mobile search toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="size-11 sm:hidden"
            aria-label="Search"
            onClick={() => setSearchOpen((v) => !v)}
          >
            {searchOpen ? <X className="size-5" /> : <Search className="size-5" />}
          </Button>

          <div className="hidden items-center gap-2 sm:flex">
            <LibraryDialog />
            <UploadSheet />
          </div>
          {/* Mobile: icon-only triggers via CSS - LibraryDialog/UploadSheet handle their own sm:hidden sizing */}
          <div className="flex items-center gap-1 sm:hidden">
            <LibraryDialog />
            <UploadSheet />
          </div>
        </div>
      </div>

      {/* Mobile search overlay */}
      {searchOpen && (
        <form
          className="border-t bg-background px-3 py-2 sm:hidden"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) {
              router.push(`/search?q=${encodeURIComponent(q.trim())}`);
              setSearchOpen(false);
            }
          }}
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            aria-label="Search people"
            autoFocus
            className="min-h-11 text-base"
          />
        </form>
      )}
    </header>
  );
}
