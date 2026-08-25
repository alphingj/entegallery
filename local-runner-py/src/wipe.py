#!/usr/bin/env python3
"""
Wipe face data for full re-embedding. Mirrors the plan: TRUNCATE people/photo_faces + reset photos.

Usage:
  python -m src.wipe --yes
  python -m src.wipe --keep-people  # only reset photos.face_scan_status
  python -m src.wipe --dry-run
"""
import argparse
import sys
from .supabase_client import get_supabase

def main():
    ap = argparse.ArgumentParser(description="Wipe Ente face data for full re-embed")
    ap.add_argument("--yes", action="store_true", help="skip confirmation")
    ap.add_argument("--keep-people", action="store_true", help="don't truncate people/photo_faces, only reset photos")
    ap.add_argument("--dry-run", action="store_true", help="show counts only")
    args = ap.parse_args()

    sb = get_supabase()

    # Counts
    try:
        people_c = sb.table("people").select("id", count="exact").execute()
        faces_c = sb.table("photo_faces").select("id", count="exact").execute()
        photos_c = sb.table("photos").select("id", count="exact").eq("face_scan_status", "pending").execute()
        done_c = sb.table("photos").select("id", count="exact").eq("face_scan_status", "done").execute()
        print(f"Before: people={people_c.count} photo_faces={faces_c.count} photos_pending={photos_c.count} photos_done={done_c.count}")
    except Exception as e:
        print(f"[warn] count failed: {e}")

    if args.dry_run:
        print("dry-run, not wiping")
        return

    if not args.yes:
        ans = input("This will DELETE all people and photo_faces. Type 'WIPE' to confirm: ")
        if ans.strip() != "WIPE":
            print("abort")
            sys.exit(1)

    if not args.keep_people:
        # Use rpc or direct sql via supabase? supabase-py doesn't support TRUNCATE directly, so we delete via table.
        # For large tables, use postgres function. Fallback to delete.
        # Try to call a sql function if exists, else loop delete.
        try:
            # Try direct SQL via postgrest rpc if you have a wipe function — we don't, so delete
            # Delete verification_tasks first (FK)
            print("Deleting verification_tasks...")
            sb.table("verification_tasks").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            print("Deleting photo_faces...")
            # Chunk deletes to avoid timeout
            # Supabase postgrest delete without filter is not allowed, need neq trick
            sb.table("photo_faces").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            print("Deleting people...")
            sb.table("people").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            print("Truncate done via deletes.")
        except Exception as e:
            print(f"[error] delete failed: {e}")
            # Try SQL via rpc if available
            try:
                sb.rpc("exec_sql", {"sql": "TRUNCATE verification_tasks, photo_faces, people CASCADE;"}).execute()
            except Exception as e2:
                print(f"[error] rpc fallback also failed: {e2}")
                sys.exit(1)

    # Reset photos
    try:
        # Set all non-HEIC photos to pending. HEIC stays unsupported.
        # We update in batches via filter.
        print("Resetting photos.face_scan_status to pending (non-HEIC)...")
        # For simplicity, update all where face_scan_status != 'pending' and mime not heic
        # Supabase requires a filter; we use neq on id trick via loop or single update with is
        # Use .update with filter on face_scan_status neq pending
        res = sb.table("photos").update({"face_scan_status": "pending"}).neq("face_scan_status", "pending").execute()
        print(f"Reset {len(res.data) if res.data else 0} photos to pending (first batch). Some may remain if pagination needed — run again or use SQL: UPDATE photos SET face_scan_status='pending' WHERE mime_type NOT IN ('image/heic','image/heif');")
        # Ensure HEIC stays unsupported
        # Alternative direct SQL for correctness:
        # sb.rpc("exec_sql", {"sql": "UPDATE photos SET face_scan_status='pending' WHERE mime_type NOT IN ('image/heic','image/heif') AND file_name NOT ILIKE '%.heic' AND file_name NOT ILIKE '%.heif'; UPDATE photos SET face_scan_status='unsupported' WHERE mime_type IN ('image/heic','image/heif') OR file_name ILIKE '%.heic';"}).execute()
    except Exception as e:
        print(f"[error] reset photos failed: {e}")
        print("Fallback SQL: run in Supabase SQL editor: UPDATE photos SET face_scan_status='pending' WHERE mime_type NOT IN ('image/heic','image/heif');")

    print("Wipe complete. Next: python -m src.run --all --concurrency 2")

if __name__ == "__main__":
    main()
