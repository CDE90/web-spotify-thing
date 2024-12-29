import { DateSelector } from "@/components/ui-parts/DateSelector";
import {
    type DailyPlaytime,
    PlaytimeChart,
} from "@/components/ui-parts/PlaytimeChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableHeadRow,
    TableRow,
} from "@/components/ui/table";
import { db } from "@/server/db";
import {
    albums,
    artists,
    artistTracks,
    listeningHistory,
    tracks,
    users,
} from "@/server/db/schema";
import { getSpotifyAccount, setUserTracking } from "@/server/lib";
import { RedirectToSignIn } from "@clerk/nextjs";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, asc, desc, eq, gte, lte, type SQL, sql } from "drizzle-orm";
import Image from "next/image";
import Link from "next/link";

function dateFormatter(date: Date) {
    // Return the date in the format "YYYY-MM-DD"
    return date.toISOString().split("T")[0];
}

function readDate(date: string | null, defaultValue: Date) {
    if (!date) {
        return defaultValue;
    }

    try {
        return new Date(date);
    } catch {
        return defaultValue;
    }
}

function isSameDay(date1: Date, date2: Date) {
    return (
        date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate()
    );
}

async function fetchDailyPlaytime(
    userId: string,
    timeFilters: SQL<unknown> | undefined,
    startDate: Date,
    endDate: Date,
    isSingleDayView: boolean,
): Promise<DailyPlaytime[]> {
    if (isSingleDayView) {
        const aggPlaytimeSq = db.$with("agg_playtime").as(
            db
                .select({
                    playedAt:
                        sql<number>`date_part('hour', ${listeningHistory.playedAt})::int`.as(
                            "playedAt",
                        ),
                    playtime:
                        sql<number>`sum(${listeningHistory.progressMs}) / 1000`.as(
                            "playtime",
                        ),
                })
                .from(listeningHistory)
                .where(
                    and(
                        timeFilters,
                        gte(listeningHistory.progressMs, 30 * 1000),
                        eq(listeningHistory.userId, userId),
                    ),
                )
                .groupBy(sql`date_part('hour', ${listeningHistory.playedAt})`),
        );

        const hoursSq = db.$with("hours").as(
            db
                .select({
                    hour: sql<number>`hh::int`.as("hour"),
                })
                .from(sql`generate_series(0, 23) as hh`),
        );

        return db
            .with(hoursSq, aggPlaytimeSq)
            .select({
                date: sql<string>`${sql.raw(`'${startDate.toLocaleDateString()}'`)} || ' ' || 
                       case when ${hoursSq.hour} < 10 
                            then '0' || ${hoursSq.hour}::text 
                            else ${hoursSq.hour}::text 
                       end || ':00'`,
                playtime: sql<number>`coalesce(${aggPlaytimeSq.playtime}, 0)::int`,
            })
            .from(hoursSq)
            .leftJoin(aggPlaytimeSq, eq(hoursSq.hour, aggPlaytimeSq.playedAt))
            .orderBy(asc(hoursSq.hour));
    } else {
        const aggPlaytimeSq = db.$with("agg_playtime").as(
            db
                .select({
                    playedAt:
                        sql<string>`${listeningHistory.playedAt}::date`.as(
                            "playedAt",
                        ),
                    playtime:
                        sql<number>`sum(${listeningHistory.progressMs}) / 1000`.as(
                            "playtime",
                        ),
                })
                .from(listeningHistory)
                .where(
                    and(
                        timeFilters,
                        gte(listeningHistory.progressMs, 30 * 1000),
                        eq(listeningHistory.userId, userId),
                    ),
                )
                .groupBy(sql`${listeningHistory.playedAt}::date`),
        );

        const datesSq = db.$with("dates").as(
            db
                .select({
                    date: sql<string>`dd::date`.as("date"),
                })
                .from(
                    sql`generate_series(${dateFormatter(startDate)}::timestamp, ${dateFormatter(endDate)}::timestamp, '1 day'::interval) as dd`,
                ),
        );

        return db
            .with(datesSq, aggPlaytimeSq)
            .select({
                date: datesSq.date,
                playtime: sql<number>`coalesce(${aggPlaytimeSq.playtime}, 0)::int`,
            })
            .from(datesSq)
            .leftJoin(aggPlaytimeSq, eq(datesSq.date, aggPlaytimeSq.playedAt));
    }
}

export default async function DashboardPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[]>>;
}) {
    const { userId } = await auth();

    if (!userId) {
        return <RedirectToSignIn />;
    }

    // Handle user setup
    const dbUsers = await db.select().from(users).where(eq(users.id, userId));
    if (!dbUsers.length) {
        const apiClient = await clerkClient();
        const spotifyAccount = await getSpotifyAccount(apiClient, userId);
        if (spotifyAccount) {
            await setUserTracking(true, userId, spotifyAccount.externalId);
        }
    }

    const actualParams = await searchParams;
    // @ts-expect-error this is fine
    const searchParamsCopy = new URLSearchParams(actualParams);

    // Get initial date range
    const firstListeningHistoryEntry = await db
        .select({
            playedAt: sql<string>`${listeningHistory.playedAt}::date`.as(
                "playedAt",
            ),
        })
        .from(listeningHistory)
        .where(eq(listeningHistory.userId, userId))
        .orderBy(asc(listeningHistory.playedAt))
        .limit(1);

    const defaultStartDate = firstListeningHistoryEntry.length
        ? new Date(firstListeningHistoryEntry[0]!.playedAt)
        : new Date(new Date().getTime() - 365 * 24 * 60 * 60 * 1000);

    const startDate = readDate(searchParamsCopy.get("from"), defaultStartDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = readDate(searchParamsCopy.get("to"), new Date());
    endDate.setHours(23, 59, 59, 999);

    const timeFilters = and(
        gte(listeningHistory.playedAt, startDate),
        lte(listeningHistory.playedAt, endDate),
    );

    const limit = parseInt(searchParamsCopy.get("limit") ?? "10");
    const isSingleDayView = isSameDay(startDate, endDate);

    // Parallel data fetching
    const [
        topArtists,
        topTracks,
        topAlbums,
        totalProgressMs,
        totalArtistsCount,
        totalTracksCount,
        dailyPlaytime,
    ] = await Promise.all([
        // Top Artists
        db
            .select({
                count: sql<number>`count(*)`,
                artist: artists.name,
                imageUrl: artists.imageUrl,
                artistId: artists.id,
            })
            .from(listeningHistory)
            .innerJoin(tracks, eq(listeningHistory.trackId, tracks.id))
            .innerJoin(artistTracks, eq(tracks.id, artistTracks.trackId))
            .innerJoin(artists, eq(artistTracks.artistId, artists.id))
            .where(
                and(
                    timeFilters,
                    eq(listeningHistory.userId, userId),
                    gte(listeningHistory.progressMs, 30 * 1000),
                    eq(artistTracks.isPrimaryArtist, true),
                ),
            )
            .groupBy(artists.id)
            .orderBy(
                desc(sql`count(*)`),
                desc(sql`sum(${listeningHistory.progressMs})`),
                asc(artists.name),
            )
            .limit(limit),

        // Top Tracks
        db
            .select({
                count: sql<number>`count(*)`,
                track: tracks.name,
                imageUrl: albums.imageUrl,
                trackId: tracks.id,
            })
            .from(listeningHistory)
            .innerJoin(tracks, eq(listeningHistory.trackId, tracks.id))
            .innerJoin(albums, eq(tracks.albumId, albums.id))
            .where(
                and(
                    timeFilters,
                    eq(listeningHistory.userId, userId),
                    gte(listeningHistory.progressMs, 30 * 1000),
                ),
            )
            .groupBy(tracks.id, albums.imageUrl)
            .orderBy(
                desc(sql`count(*)`),
                desc(sql`sum(${listeningHistory.progressMs})`),
                asc(tracks.name),
            )
            .limit(limit),

        // Top Albums
        db
            .select({
                count: sql<number>`count(*)`,
                album: albums.name,
                imageUrl: albums.imageUrl,
                albumId: albums.id,
            })
            .from(listeningHistory)
            .innerJoin(tracks, eq(listeningHistory.trackId, tracks.id))
            .innerJoin(albums, eq(tracks.albumId, albums.id))
            .where(
                and(
                    timeFilters,
                    eq(listeningHistory.userId, userId),
                    gte(listeningHistory.progressMs, 30 * 1000),
                ),
            )
            .groupBy(albums.id, albums.imageUrl)
            .orderBy(
                desc(sql`count(*)`),
                desc(sql`sum(${listeningHistory.progressMs})`),
                asc(albums.name),
            )
            .limit(limit),

        // Total Progress
        db
            .select({
                duration: sql<number>`sum(${listeningHistory.progressMs})`,
            })
            .from(listeningHistory)
            .where(and(eq(listeningHistory.userId, userId), timeFilters)),

        // Total Artists
        db
            .select({
                countArtists: sql<number>`count(distinct ${artistTracks.artistId})`,
            })
            .from(listeningHistory)
            .innerJoin(
                artistTracks,
                eq(listeningHistory.trackId, artistTracks.trackId),
            )
            .where(
                and(
                    eq(listeningHistory.userId, userId),
                    timeFilters,
                    gte(listeningHistory.progressMs, 30 * 1000),
                ),
            ),

        // Total Tracks
        db
            .select({
                countTracks: sql<number>`count(distinct ${listeningHistory.trackId})`,
            })
            .from(listeningHistory)
            .where(
                and(
                    eq(listeningHistory.userId, userId),
                    timeFilters,
                    gte(listeningHistory.progressMs, 30 * 1000),
                ),
            ),

        // Daily Playtime
        fetchDailyPlaytime(
            userId,
            timeFilters,
            startDate,
            endDate,
            isSingleDayView,
        ),
    ]);

    const totalMinutes = totalProgressMs[0]?.duration
        ? Math.round(totalProgressMs[0].duration / 60000)
        : 0;
    const totalArtists = totalArtistsCount[0]?.countArtists ?? 0;
    const totalTracks = totalTracksCount[0]?.countTracks ?? 0;

    return (
        <div className="p-4">
            <h1 className="mb-2 text-2xl font-bold">Dashboard</h1>
            <DateSelector
                baseUrl={process.env.COOLIFY_URL ?? "http://localhost:3000"}
                className="mb-4"
                startDate={startDate}
                endDate={endDate}
                dataStartDate={defaultStartDate}
            />

            <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader>
                        <CardTitle>Total Minutes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-lg font-semibold">
                            {Math.round(totalMinutes).toLocaleString()}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Total Artists</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-lg font-semibold">
                            {totalArtists.toLocaleString()}
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Total Tracks</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-lg font-semibold">
                            {totalTracks.toLocaleString()}
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <Card>
                    <CardHeader>
                        <CardTitle>Top Artists</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableHeadRow>
                                    <TableHead>Rank</TableHead>
                                    <TableHead>Artist</TableHead>
                                    <TableHead>Count</TableHead>
                                </TableHeadRow>
                            </TableHeader>
                            <TableBody>
                                {topArtists.map((artist, index) => (
                                    <TableRow key={artist.artistId}>
                                        <TableCell>{index + 1}</TableCell>
                                        <TableCell>
                                            <Link
                                                className="flex h-12 items-center gap-4 text-wrap underline-offset-4 hover:underline"
                                                href={`https://open.spotify.com/artist/${artist.artistId}`}
                                                target="_blank"
                                            >
                                                {artist.imageUrl ? (
                                                    <Image
                                                        src={artist.imageUrl}
                                                        alt={artist.artist}
                                                        width={48}
                                                        height={48}
                                                        className="h-12 w-12"
                                                    />
                                                ) : null}
                                                {artist.artist}
                                            </Link>
                                        </TableCell>
                                        <TableCell>{artist.count}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Top Tracks</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableHeadRow>
                                    <TableHead>Rank</TableHead>
                                    <TableHead>Track</TableHead>
                                    <TableHead>Count</TableHead>
                                </TableHeadRow>
                            </TableHeader>
                            <TableBody>
                                {topTracks.map((track, index) => (
                                    <TableRow key={track.trackId}>
                                        <TableCell>{index + 1}</TableCell>
                                        <TableCell>
                                            <Link
                                                className="flex items-center gap-4 text-wrap underline-offset-4 hover:underline"
                                                href={`https://open.spotify.com/track/${track.trackId}`}
                                                target="_blank"
                                            >
                                                {track.imageUrl ? (
                                                    <Image
                                                        src={track.imageUrl}
                                                        alt={track.track}
                                                        width={48}
                                                        height={48}
                                                        className="h-12 w-12"
                                                    />
                                                ) : null}
                                                {track.track}
                                            </Link>
                                        </TableCell>
                                        <TableCell>{track.count}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Top Albums</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableHeadRow>
                                    <TableHead>Rank</TableHead>
                                    <TableHead>Album</TableHead>
                                    <TableHead>Count</TableHead>
                                </TableHeadRow>
                            </TableHeader>
                            <TableBody>
                                {topAlbums.map((album, index) => (
                                    <TableRow key={album.albumId}>
                                        <TableCell>{index + 1}</TableCell>
                                        <TableCell>
                                            <Link
                                                className="flex h-12 items-center gap-4 text-wrap underline-offset-4 hover:underline"
                                                href={`https://open.spotify.com/album/${album.albumId}`}
                                                target="_blank"
                                            >
                                                {album.imageUrl ? (
                                                    <Image
                                                        src={album.imageUrl}
                                                        alt={album.album}
                                                        width={48}
                                                        height={48}
                                                        className="h-12 w-12"
                                                    />
                                                ) : null}
                                                {album.album}
                                            </Link>
                                        </TableCell>
                                        <TableCell>{album.count}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            <div className="mb-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Daily Playtime</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <PlaytimeChart dailyPlaytime={dailyPlaytime} />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
