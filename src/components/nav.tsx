"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Images, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadSheet } from "@/components/upload-sheet";
import { cn } from "@/lib/utils";

export function Nav({ active }: { active: "photos" | "people" }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground text-sm">
            E
          </span>
          Ente Gallery
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className={cn(active === "photos" && "bg-secondary")}
          >
            <Link href="/"><Images className="size-4" /> Photos</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className={cn(active === "people" && "bg-secondary")}
          >
            <Link href="/people"><Users className="size-4" /> People</Link>
          </Button>
        </nav>

        <form
          className="ml-auto w-full max-w-xs"
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
          />
        </form>

        <UploadSheet />
      </div>
    </header>
  );
}
