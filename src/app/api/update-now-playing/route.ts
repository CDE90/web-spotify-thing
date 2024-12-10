// POST /api/update-now-playing
// This endpoint will trigger the syncing of currently playing songs for tracked users

import { clerkClient } from "@clerk/nextjs/server";
import type { InferInsertModel } from "drizzle-orm";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { getSpotifyToken } from "@/server/lib";
import { getCurrentlyPlaying } from "@/server/spotify/spotify";

type ArtistInsertModel = InferInsertModel<typeof schema.artists>;
type AlbumInsertModel = InferInsertModel<typeof schema.albums>;
type ArtistAlbumInsertModel = InferInsertModel<typeof schema.artistAlbums>;
type TrackInsertModel = InferInsertModel<typeof schema.tracks>;
type ArtistTrackInsertModel = InferInsertModel<typeof schema.artistTracks>;
type ListeningHistoryInsertModel = InferInsertModel<
    typeof schema.listeningHistory
>;

export async function GET(request: Request) {
    if (env.NODE_ENV === "production") {
        // Return 404 in production
        return new Response("Not found", { status: 404 });
    }
    // Otherwise, send the response from POST
    return POST(request);
}

/*
To correctly schedule, we need to add the following cron jobs:

    * * * * *            curl -X POST -H "Authorization: Bearer [token]" -H "premium-only: false" https://[domain]/api/update-now-playing
    * * * * * (sleep 20; curl -X POST -H "Authorization: Bearer [token]" -H "premium-only: true" https://[domain]/api/update-now-playing)
    * * * * * (sleep 40; curl -X POST -H "Authorization: Bearer [token]" -H "premium-only: true" https://[domain]/api/update-now-playing)

This is a slightly hacky solution to get around the fact that cron jobs only run once per minute, but it works.
*/

// When the environment is production, this endpoint will be protected by a bearer token
export async function POST(request: Request) {
    const headers = request.headers;
    const token = headers.get("Authorization");
    const premiumOnly = headers.get("premium-only");

    if (env.NODE_ENV === "production") {
        if (!token) {
            return new Response("Unauthorized", { status: 401 });
        }

        const bearerToken = token.split(" ")[1];

        if (bearerToken !== env.SYNC_ENDPOINT_TOKEN) {
            return new Response("Unauthorized", { status: 401 });
        }
    }

    // Get Clerk API client
    const apiClient = await clerkClient();

    // Get all enabled users
    const filters = [eq(schema.users.enabled, true)];

    if (premiumOnly === "true") {
        filters.push(eq(schema.users.premiumUser, true));
    }

    const users = await db
        .select()
        .from(schema.users)
        .where(and(...filters));

    for (const user of users) {
        // Get the user's Spotify access token
        const spotifyToken = await getSpotifyToken(apiClient, user.id);

        if (!spotifyToken) {
            continue;
        }

        // Get the currently playing song
        const currentlyPlaying = await getCurrentlyPlaying(spotifyToken);

        if (!currentlyPlaying?.is_playing) {
            continue;
        }

        // If the item is an Episode, we skip
        if (
            !currentlyPlaying.item ||
            currentlyPlaying.item?.type === "episode"
        ) {
            continue;
        }

        const track = currentlyPlaying.item;

        const dbTracks = await db
            .select()
            .from(schema.tracks)
            .where(eq(schema.tracks.id, track.id));

        if (!dbTracks.length) {
            // First insert the artists
            const trackArtists: ArtistInsertModel[] = track.artists.map(
                (artist) => ({
                    id: artist.id,
                    name: artist.name,
                }),
            );
            const albumArtists: ArtistInsertModel[] = track.album.artists.map(
                (artist) => ({
                    id: artist.id,
                    name: artist.name,
                }),
            );

            // Combine the artists (removing duplicates)
            const artists = [...new Set([...trackArtists, ...albumArtists])];

            await db
                .insert(schema.artists)
                .values(artists)
                .onConflictDoNothing();

            // Then insert the album
            const albumReleaseDate = new Date(track.album.release_date);
            const album: AlbumInsertModel = {
                id: track.album.id,
                name: track.album.name,
                albumType: track.album.album_type,
                releaseDate: albumReleaseDate,
                totalTracks: track.album.total_tracks,
            };

            await db.insert(schema.albums).values(album).onConflictDoNothing();

            // Then insert the artist-album relationship
            const artistAlbums: ArtistAlbumInsertModel[] =
                track.album.artists.map((artist) => ({
                    artistId: artist.id,
                    albumId: track.album.id,
                }));

            await db
                .insert(schema.artistAlbums)
                .values(artistAlbums)
                .onConflictDoNothing();

            // Then insert the track
            const dbTrack: TrackInsertModel = {
                id: track.id,
                name: track.name,
                albumId: track.album.id,
                durationMs: track.duration_ms,
                popularity: track.popularity,
            };

            await db
                .insert(schema.tracks)
                .values(dbTrack)
                .onConflictDoNothing();

            // Then insert the artist-track relationship
            const artistTracks: ArtistTrackInsertModel[] = track.artists.map(
                (artist) => ({
                    artistId: artist.id,
                    trackId: track.id,
                }),
            );

            await db
                .insert(schema.artistTracks)
                .values(artistTracks)
                .onConflictDoNothing();
        }

        // Finally, insert the listening history

        // rules:
        // - (A) if the current track is the same as the previous track, don't insert a new row, but update the progress_ms column
        // - (B) if the current and previous tracks are different ( (C) or no previous track exists), insert a new row
        //     - (D) additionally, if the previous track progress_ms is less than 20 seconds, remove the previous row (as they haven't listened enough to count)
        //     - (E) additionally, if the previous track progress_ms is greater than 80% of that track's duration, set the progress_ms to equal that track's duration

        const previousListenings = await db
            .select()
            .from(schema.listeningHistory)
            .leftJoin(
                schema.tracks,
                eq(schema.listeningHistory.trackId, schema.tracks.id),
            )
            .where(eq(schema.listeningHistory.userId, user.id))
            .orderBy(desc(schema.listeningHistory.playedAt))
            .limit(1);

        // (C)
        if (!previousListenings.length) {
            // No previous track, so we can just insert a new row
            const playedAt = new Date(currentlyPlaying.timestamp);
            const listeningHistory: ListeningHistoryInsertModel = {
                userId: user.id,
                trackId: track.id,
                playedAt,
                progressMs: currentlyPlaying.progress_ms,
                deviceName: currentlyPlaying.device?.name,
                deviceType: currentlyPlaying.device?.type,
            };

            await db
                .insert(schema.listeningHistory)
                .values(listeningHistory)
                .onConflictDoNothing();

            return NextResponse.json({ success: true });
        }

        const previousListening = previousListenings[0]!.listening_history;
        const previousTrack = previousListenings[0]!.track;

        // (A)
        if (track.id === previousListening.trackId) {
            // Update the progress_ms column
            await db
                .update(schema.listeningHistory)
                .set({
                    progressMs: currentlyPlaying.progress_ms,
                })
                .where(eq(schema.listeningHistory.id, previousListening.id));
        }

        // (B)
        else {
            // (D)
            if (previousListening.progressMs < 20000) {
                // Remove the previous row (as they haven't listened enough to count)
                await db
                    .delete(schema.listeningHistory)
                    .where(
                        eq(schema.listeningHistory.id, previousListening.id),
                    );
            }
            // (E)
            else if (
                previousTrack?.durationMs &&
                (previousListening.progressMs >
                    0.8 * previousTrack.durationMs ||
                    previousTrack.durationMs < 60000)
            ) {
                // Update the previous row to set the progress to 100%
                await db
                    .update(schema.listeningHistory)
                    .set({ progressMs: previousTrack.durationMs })
                    .where(
                        eq(schema.listeningHistory.id, previousListening.id),
                    );
            }
            // Generic (B) - insert a new row
            const playedAt = new Date(currentlyPlaying.timestamp);
            const newListeningHistory: ListeningHistoryInsertModel = {
                userId: user.id,
                trackId: track.id,
                playedAt,
                progressMs: currentlyPlaying.progress_ms,
                deviceName: currentlyPlaying.device?.name,
                deviceType: currentlyPlaying.device?.type,
            };
            await db
                .insert(schema.listeningHistory)
                .values(newListeningHistory)
                .onConflictDoNothing();
        }
    }

    return NextResponse.json({ success: true });
}
