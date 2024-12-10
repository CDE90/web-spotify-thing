import type { Albums, Artists, PlaybackState } from "./types";
import { env } from "@/env";

export async function getGlobalAccessToken() {
    const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
            Authorization: `Basic ${Buffer.from(
                `${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`,
            ).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
    });

    // Handle invalid status codes
    if (!response.ok) {
        throw new Error(
            `getGlobalAccessToken: HTTP error! status: ${response.status}`,
        );
    }

    if (response.status !== 200) {
        return null;
    }

    const responseJson = (await response.json()) as {
        access_token: string;
        token_type: string;
        expires_in: number;
    };

    return responseJson.access_token;
}

export async function getCurrentlyPlaying(accessToken: string) {
    const response = await fetch(
        "https://api.spotify.com/v1/me/player/currently-playing",
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    );

    // Handle invalid status codes
    if (!response.ok) {
        throw new Error(
            `getCurrentlyPlaying: HTTP error! status: ${response.status}`,
        );
    }

    if (response.status !== 200) {
        return null;
    }

    const responseJson = (await response.json()) as PlaybackState;

    return responseJson;
}

export async function getSeveralArtists(accessToken: string, ids: string[]) {
    // Check if there are more than 50 ids
    if (ids.length > 50) {
        throw new Error("Too many ids");
    }

    const response = await fetch(
        `https://api.spotify.com/v1/artists?ids=${ids.join(",")}`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    );

    // Handle invalid status codes
    if (!response.ok) {
        throw new Error(
            `getSeveralArtists: HTTP error! status: ${response.status}`,
        );
    }

    if (response.status !== 200) {
        return null;
    }

    const responseJson = (await response.json()) as Artists;

    return responseJson;
}

export async function getSeveralAlbums(accessToken: string, ids: string[]) {
    // Check if there are more than 20 ids
    if (ids.length > 20) {
        throw new Error("Too many ids");
    }

    const response = await fetch(
        `https://api.spotify.com/v1/albums?ids=${ids.join(",")}`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    );

    // Handle invalid status codes
    if (!response.ok) {
        throw new Error(
            `getSeveralAlbums: HTTP error! status: ${response.status}`,
        );
    }

    if (response.status !== 200) {
        return null;
    }

    const responseJson = (await response.json()) as Albums;

    return responseJson;
}
