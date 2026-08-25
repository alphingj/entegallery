package com.ente.gallery.data

import android.content.Context
import com.ente.gallery.BuildConfig
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.serialization.json.*

data class PhotoRow(
    val id: String,
    val google_drive_file_id: String,
    val file_name: String?,
    val mime_type: String?,
    val width: Int?,
    val height: Int?,
    val face_scan_status: String? = null,
    val created_at: String
)

class SupabaseRepo(ctx: Context) {
    private val client = createSupabaseClient(
        supabaseUrl = BuildConfig.SUPABASE_URL,
        supabaseKey = BuildConfig.SUPABASE_ANON_KEY
    ) {
        install(Postgrest)
        install(Auth)
    }

    // direct postgrest — requires RLS policy per SECURITY.md, else use Edge Function
    suspend fun fetchPending(limit: Int = 25): List<PhotoRow> {
        val res = client.postgrest["photos"]
            .select {
                filter { eq("face_scan_status", "pending") }
                order("created_at", Order.ASCENDING)
                limit(limit.toLong())
            }.decodeList<PhotoRowJson>()
        return res.map { it.toRow() }
    }

    suspend fun fetchAll(cursorCreatedAt: String? = null, limit: Int = 25): List<PhotoRow> {
        var q = client.postgrest["photos"].select {
            order("created_at", Order.ASCENDING)
            limit(limit.toLong())
        }
        // supabase-kt doesn't support gt on string easily via builder, fallback to raw filter
        if (cursorCreatedAt != null) {
            q = client.postgrest["photos"].select {
                filter { gt("created_at", cursorCreatedAt) }
                order("created_at", Order.ASCENDING)
                limit(limit.toLong())
            }
        }
        return q.decodeList<PhotoRowJson>().map { it.toRow() }
    }

    suspend fun rpcMatchTop2(embedding: FloatArray, maxDist: Double): List<MatchCandidate> {
        // supabase-kt rpc: postgrest.rpc("match_person_top2", {q, max_dist})
        val body = buildJsonObject {
            put("q", JsonArray(embedding.map { JsonPrimitive(it) }))
            put("max_dist", maxDist)
        }
        return try {
            client.postgrest.rpc("match_person_top2", body).decodeList<MatchCandidate>()
        } catch (e: Exception) {
            emptyList()
        }
    }

    suspend fun insertPerson(name: String = "Unknown", descriptor: FloatArray): String {
        val row = buildJsonObject {
            put("name", name)
            put("descriptor", JsonArray(descriptor.map { JsonPrimitive(it) }))
        }
        val res = client.postgrest["people"].insert(row).decodeSingle<PersonRow>()
        return res.id
    }

    suspend fun insertFace(photoId: String, personId: String, box: Map<String, Double>, descriptor: FloatArray) {
        val row = buildJsonObject {
            put("photo_id", photoId)
            put("person_id", personId)
            put("bounding_box", JsonObject(box.mapValues { JsonPrimitive(it.value) }))
            put("descriptor", JsonArray(descriptor.map { JsonPrimitive(it) }))
        }
        client.postgrest["photo_faces"].insert(row)
    }

    suspend fun markDone(photoId: String, width: Int?, height: Int?) {
        val patch = buildJsonObject {
            put("face_scan_status", "done")
            if (width != null) put("width", width)
            if (height != null) put("height", height)
        }
        client.postgrest["photos"].update(patch) { filter { eq("id", photoId) } }
    }

    suspend fun markUnsupported(photoId: String) {
        client.postgrest["photos"].update(buildJsonObject { put("face_scan_status", "unsupported") }) {
            filter { eq("id", photoId) }
        }
    }
}

// serialization helpers (kotlinx)
@kotlinx.serialization.Serializable
private data class PhotoRowJson(
    val id: String,
    val google_drive_file_id: String,
    val file_name: String? = null,
    val mime_type: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val face_scan_status: String? = null,
    val created_at: String
) { fun toRow() = PhotoRow(id, google_drive_file_id, file_name, mime_type, width, height, face_scan_status, created_at) }

@kotlinx.serialization.Serializable
data class MatchCandidate(val person_id: String, val name: String, val distance: Double)

@kotlinx.serialization.Serializable
private data class PersonRow(val id: String, val name: String)
