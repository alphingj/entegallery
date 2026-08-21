"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchPeople, fetchPersonFaces } from "@/lib/api-client";
import { FaceCrop } from "@/components/face-crop";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Nav } from "@/components/nav";

/**
 * Type a name → matching people → their actual face crops from each photo
 * they appear in (not the full photo), even when photos contain many faces.
 */
export function SearchView({ query }: { query: string }) {
  const router = useRouter();
  const [input, setInput] = useState(query);
  const [pickedPersonId, setPickedPersonId] = useState<string | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["people-search", query],
    queryFn: () => fetchPeople(query),
    enabled: query.trim().length > 0,
  });

  const people = data?.people ?? [];
  // Derived selection: the picked person if still valid, else the best match.
  const selectedPersonId =
    pickedPersonId && people.some((p) => p.id === pickedPersonId)
      ? pickedPersonId
      : (people[0]?.id ?? null);

  const { data: selectedFaces } = useQuery({
    queryKey: ["person-faces", selectedPersonId],
    queryFn: () => fetchPersonFaces(selectedPersonId!),
    enabled: !!selectedPersonId,
  });

  return (
    <>
      <Nav active="photos" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) router.push(`/search?q=${encodeURIComponent(input.trim())}`);
          }}
          className="mb-6"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search people by name…"
            autoFocus
            className="w-full rounded-xl border bg-card px-4 py-3 text-lg outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:ring-2"
          />
        </form>

        {query ? (
          isFetching ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-lg" />
              ))}
            </div>
          ) : people.length === 0 ? (
            <p className="py-24 text-center text-sm text-muted-foreground">
              No people named “{query}” yet.
            </p>
          ) : (
            <div className="space-y-8">
              {people.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {people.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPickedPersonId(p.id)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        selectedPersonId === p.id
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-secondary"
                      }`}
                    >
                      {p.name} ({p.photoCount})
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {(selectedFaces?.items ?? []).map((item) => (
                  <Link key={item.faceId} href={`/people/${selectedPersonId}`} className="group space-y-1.5">
                    <FaceCrop
                      item={item}
                      className="rounded-lg transition-all group-hover:brightness-110 group-hover:ring-2 group-hover:ring-primary"
                    />
                    <Badge variant="secondary" className="font-normal">
                      in photo
                    </Badge>
                  </Link>
                ))}
                {!selectedFaces && people.length > 0 && (
                  <Skeleton className="col-span-full h-40" />
                )}
              </div>
            </div>
          )
        ) : (
          <p className="py-24 text-center text-sm text-muted-foreground">
            Start typing to find people by name.
          </p>
        )}
      </main>
    </>
  );
}
