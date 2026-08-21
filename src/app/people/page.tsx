"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchPeople } from "@/lib/api-client";
import { FaceCrop } from "@/components/face-crop";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserRoundX } from "lucide-react";
import { Nav } from "@/components/nav";

export default function PeoplePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["people"],
    queryFn: () => fetchPeople(),
  });

  const people = data?.people ?? [];

  return (
    <>
      <Nav active="people" />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <h1 className="mb-4 text-lg font-semibold">People</h1>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-square rounded-lg" />
                <Skeleton className="mx-auto h-4 w-20" />
              </div>
            ))}
          </div>
        ) : people.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-32 text-center">
            <UserRoundX className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No faces yet — upload photos and detected people will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {people.map((person) => (
              <Link
                key={person.id}
                href={`/people/${person.id}`}
                className="group space-y-2"
              >
                {person.face ? (
                  <FaceCrop
                    item={person.face}
                    className="rounded-lg ring-border transition-all group-hover:ring-2 group-hover:ring-primary"
                  />
                ) : (
                  <div className="grid aspect-square place-items-center rounded-lg bg-muted">
                    <UserRoundX className="size-8 text-muted-foreground" />
                  </div>
                )}
                <div className="text-center">
                  <p
                    className={`truncate text-sm font-medium ${
                      person.name === "Unknown" ? "italic text-muted-foreground" : ""
                    }`}
                  >
                    {person.name}
                  </p>
                  <Badge variant="secondary" className="mt-0.5 font-normal">
                    {person.photoCount} photo{person.photoCount === 1 ? "" : "s"}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
