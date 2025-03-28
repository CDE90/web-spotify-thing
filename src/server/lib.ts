import { ordinal } from "@/lib/utils";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { type clerkClient } from "@clerk/nextjs/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { unstable_cacheLife as cacheLife } from "next/cache";
import "server-only";

export function getBaseUrl() {
    const coolifyUrl = process.env.COOLIFY_URL;
    if (coolifyUrl) {
        // Check if there's a comma in the url, if so split and return the first part
        const commaIndex = coolifyUrl.indexOf(",");
        if (commaIndex !== -1) {
            return coolifyUrl.substring(0, commaIndex);
        }
        return coolifyUrl;
    } else {
        return "http://localhost:3000";
    }
}

export interface DateRange {
    from: Date;
    to: Date;
}

export function getTimeFilters(dateRange: DateRange) {
    const timeFilters = and(
        gte(schema.listeningHistory.playedAt, dateRange.from),
        lte(schema.listeningHistory.playedAt, dateRange.to),
    );

    return timeFilters;
}

export function getPrevDateRange(currRange: DateRange) {
    const dateDiff = Math.abs(
        currRange.to.getTime() - currRange.from.getTime(),
    );
    return {
        to: currRange.from,
        from: new Date(currRange.from.getTime() - dateDiff),
    } satisfies DateRange;
}

export async function setUserTracking(
    enabled: boolean,
    userId: string,
    spotifyId: string,
) {
    "use server";

    const dbUsers = await db
        .insert(schema.users)
        .values({
            id: userId,
            spotifyId: spotifyId,
            premiumUser: false,
            enabled,
        })
        .onConflictDoUpdate({
            target: schema.users.id,
            set: { enabled },
        })
        .returning();

    return dbUsers[0]!;
}

type ClerkClient = Awaited<ReturnType<typeof clerkClient>>;

export async function getSpotifyToken(apiClient: ClerkClient, userId: string) {
    const clerkTokenResponse = await apiClient.users.getUserOauthAccessToken(
        userId,
        "spotify",
    );

    if (!clerkTokenResponse.data) {
        return null;
    }

    const data = clerkTokenResponse.data[0]!;
    const accessToken = data.token;

    return accessToken;
}

export async function getSpotifyAccount(
    apiClient: ClerkClient,
    clerkUserId: string,
) {
    const userResponse = await apiClient.users.getUser(clerkUserId);

    const spotifyAccounts = userResponse.externalAccounts.filter(
        (account) => account.provider === "oauth_spotify",
    );

    if (!spotifyAccounts.length) {
        return null;
    }

    return spotifyAccounts[0]!;
}

export function chunkArray<T>(arr: T[], chunkSize: number) {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        const chunk = arr.slice(i, i + chunkSize);
        chunks.push(chunk);
    }
    return chunks;
}

export async function usersAreFriends(user1Id: string, user2Id: string) {
    "use cache";

    cacheLife({
        stale: 10,
        revalidate: 10,
        expire: 10,
    });

    // Check if the target user is the friend of the user
    const friends = await db
        .select()
        .from(schema.friends)
        .where(
            and(
                eq(schema.friends.userId, user1Id),
                eq(schema.friends.friendId, user2Id),
                eq(schema.friends.status, "accepted"),
            ),
        );

    if (friends.length > 0) {
        return true;
    }

    return false;
}

export async function getUserFriends(userId: string) {
    "use cache";

    cacheLife({
        stale: 10,
        revalidate: 10,
        expire: 10,
    });

    const friends = await db
        .select({
            friendId: schema.friends.friendId,
        })
        .from(schema.friends)
        .where(
            and(
                eq(schema.friends.userId, userId),
                eq(schema.friends.status, "accepted"),
            ),
        );

    return friends.map((friend) => friend.friendId);
}

export function calculateComparisons<
    TCurrent extends Record<string, unknown>,
    TPrev extends Record<string, unknown>,
    TValueKey extends string | number | symbol,
>(
    currentItems: Array<TCurrent>,
    previousItems: Array<TPrev>,
    idKey: keyof TCurrent & keyof TPrev,
    valueKey: TValueKey & keyof TCurrent & keyof TPrev,
) {
    return currentItems.map((item, currentIndex) => {
        // Find this item in previous period
        const prevItemIndex = previousItems.findIndex(
            // @ts-expect-error Based on usage, this is fine
            (prevItem) => prevItem[idKey] === item[idKey],
        );

        // Determine rank change
        const rankChange =
            prevItemIndex !== -1 ? prevItemIndex - currentIndex : null;

        // Determine value change
        const prevItem =
            prevItemIndex !== -1 ? previousItems[prevItemIndex] : null;
        const valueChange =
            prevItem &&
            typeof item[valueKey] === "number" &&
            typeof prevItem[valueKey] === "number"
                ? Number(prevItem[valueKey]) !== 0
                    ? ((Number(item[valueKey]) - Number(prevItem[valueKey])) /
                          Number(prevItem[valueKey])) *
                      100
                    : 0
                : null;

        return {
            ...item, // This preserves all properties from the current item
            rankChange,
            percentChange: valueChange,
            previousRank: prevItemIndex !== -1 ? prevItemIndex + 1 : null,
        };
    });
}

export function getRankChangeTooltip(
    rankChange: number | null,
    previousRank: number | null,
): string {
    if (rankChange === null || previousRank === null) return "";

    if (rankChange > 0) {
        return `Moved up ${rankChange} rank${rankChange !== 1 ? "s" : ""} from ${ordinal(previousRank)}`;
    } else if (rankChange < 0) {
        return `Moved down ${Math.abs(rankChange)} rank${Math.abs(rankChange) !== 1 ? "s" : ""} from ${ordinal(previousRank)}`;
    } else {
        return "Same rank as previous period";
    }
}
