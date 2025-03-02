"use server";

import { db } from "@/server/db";
import { friends } from "@/server/db/schema";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// Get all friends and friend requests for the current user
export async function getFriends() {
    const { userId } = await auth();
    if (!userId) {
        return { error: "Not authenticated" };
    }

    try {
        // Get all friend relationships where the current user is involved
        const friendships = await db
            .select({
                id: friends.id,
                userId: friends.userId,
                friendId: friends.friendId,
                status: friends.status,
                createdAt: friends.createdAt,
            })
            .from(friends)
            .where(
                or(eq(friends.userId, userId), eq(friends.friendId, userId)),
            );

        if (!friendships.length) {
            return {
                friends: [],
                pendingReceived: [],
                pendingSent: [],
            };
        }

        // Get all user IDs from the friendships
        const userIds = new Set<string>();
        friendships.forEach((f) => {
            userIds.add(f.userId);
            userIds.add(f.friendId);
        });

        // Remove the current user's ID
        userIds.delete(userId);

        // Get user information for all friends
        const friendUserIds = Array.from(userIds);
        const userDetails = await (
            await clerkClient()
        ).users.getUserList({
            userId: friendUserIds,
        });

        // Split relationships into different categories
        const acceptedFriends = [];
        const pendingReceived = [];
        const pendingSent = [];

        // Keep track of friends already processed to avoid duplicates
        const processedFriendIds = new Set<string>();

        for (const friendship of friendships) {
            const isInitiator = friendship.userId === userId;
            const otherUserId = isInitiator
                ? friendship.friendId
                : friendship.userId;
            const userDetail = userDetails.data.find(
                (u) => u.id === otherUserId,
            );

            if (!userDetail) continue;

            const friendInfo = {
                relationshipId: friendship.id,
                userId: otherUserId,
                name:
                    userDetail.firstName && userDetail.lastName
                        ? `${userDetail.firstName} ${userDetail.lastName}`
                        : userDetail.firstName
                          ? userDetail.firstName
                          : (userDetail.emailAddresses[0]?.emailAddress ??
                            otherUserId),
                imageUrl: userDetail.imageUrl ?? undefined,
                initiatedByMe: isInitiator,
                createdAt: friendship.createdAt,
            };

            if (friendship.status === "accepted") {
                // Only add to acceptedFriends if this user hasn't been processed yet
                if (!processedFriendIds.has(otherUserId)) {
                    acceptedFriends.push(friendInfo);
                    processedFriendIds.add(otherUserId);
                }
            } else if (friendship.status === "pending") {
                if (isInitiator) {
                    pendingSent.push(friendInfo);
                } else {
                    pendingReceived.push(friendInfo);
                }
            }
        }

        return {
            friends: acceptedFriends,
            pendingReceived,
            pendingSent,
        };
    } catch (error) {
        console.error("Error fetching friends:", error);
        return { error: "Failed to fetch friends" };
    }
}

// Search for users who are not already friends or have pending requests
export async function searchUsers(query: string) {
    const { userId } = await auth();
    if (!userId || !query || query.length < 2) {
        return { users: [] };
    }

    try {
        // Get all existing friend relationships for this user
        const existingRelations = await db
            .select({
                userId: friends.userId,
                friendId: friends.friendId,
            })
            .from(friends)
            .where(
                or(eq(friends.userId, userId), eq(friends.friendId, userId)),
            );

        // Create a set of user IDs that are already in some relationship with the current user
        const relatedUserIds = new Set<string>();
        existingRelations.forEach((relation) => {
            if (relation.userId !== userId) relatedUserIds.add(relation.userId);
            if (relation.friendId !== userId)
                relatedUserIds.add(relation.friendId);
        });

        // Also exclude the current user
        relatedUserIds.add(userId);

        // Search for users using Clerk whose ID is not in relatedUserIds
        const clerkUsers = await (
            await clerkClient()
        ).users.getUserList({
            query,
            limit: 10,
        });

        // Filter out users who are already related to the current user
        const filteredUsers = clerkUsers.data
            .filter((user) => !relatedUserIds.has(user.id))
            .map((user) => ({
                id: user.id,
                name:
                    user.firstName && user.lastName
                        ? `${user.firstName} ${user.lastName}`
                        : (user.emailAddresses[0]?.emailAddress ?? user.id),
                imageUrl: user.imageUrl ?? undefined,
            }));

        return { users: filteredUsers };
    } catch (error) {
        console.error("Error searching users:", error);
        return { error: "Failed to search users" };
    }
}

// Send a friend request
export async function sendFriendRequest(friendId: string) {
    const { userId } = await auth();
    if (!userId) {
        return { error: "Not authenticated" };
    }

    if (userId === friendId) {
        return { error: "Cannot add yourself as a friend" };
    }

    try {
        // Check if a relationship already exists
        const existingRelation = await db
            .select()
            .from(friends)
            .where(
                or(
                    and(
                        eq(friends.userId, userId),
                        eq(friends.friendId, friendId),
                    ),
                    and(
                        eq(friends.userId, friendId),
                        eq(friends.friendId, userId),
                    ),
                ),
            );

        if (existingRelation.length > 0) {
            return { error: "Friend request already exists" };
        }

        try {
            // Check if the friend exists in the system
            const friendExists = await (
                await clerkClient()
            ).users.getUser(friendId);
            if (!friendExists) {
                return { error: "User not found" };
            }
        } catch {
            return { error: "User not found" };
        }

        // Create a new friend request (from initiator to recipient)
        await db.insert(friends).values({
            userId,
            friendId,
            status: "pending",
        });

        revalidatePath("/friends");
        return { success: true };
    } catch (error) {
        console.error("Error sending friend request:", error);
        return { error: "Failed to send friend request" };
    }
}

// Accept a friend request
export async function acceptFriendRequest(relationId: bigint) {
    const { userId } = await auth();
    if (!userId) {
        return { error: "Not authenticated" };
    }

    try {
        // Find the pending relation
        const relation = await db
            .select({
                id: friends.id,
                userId: friends.userId,
                friendId: friends.friendId,
                status: friends.status,
            })
            .from(friends)
            .where(
                and(
                    eq(friends.id, relationId),
                    eq(friends.friendId, userId),
                    eq(friends.status, "pending"),
                ),
            );

        if (relation.length === 0) {
            return { error: "Friend request not found" };
        }

        const friendRelation = relation[0]!;

        // Ensure the relationship is valid
        if (!friendRelation.userId) {
            return { error: "Invalid friend relationship - missing userId" };
        }

        // Update the status of the current relationship to accepted
        await db
            .update(friends)
            .set({ status: "accepted" })
            .where(eq(friends.id, relationId));

        // Check if a reverse relationship already exists
        const existingReverseRelation = await db
            .select()
            .from(friends)
            .where(
                and(
                    eq(friends.userId, userId),
                    eq(friends.friendId, friendRelation.userId),
                ),
            );

        // If no reverse relationship exists, create one with accepted status
        if (existingReverseRelation.length === 0) {
            await db.insert(friends).values({
                userId: userId,
                friendId: friendRelation.userId,
                status: "accepted",
            });
        } else {
            // If it exists, update it to accepted
            await db
                .update(friends)
                .set({ status: "accepted" })
                .where(
                    and(
                        eq(friends.userId, userId),
                        eq(friends.friendId, friendRelation.userId),
                    ),
                );
        }

        revalidatePath("/friends");
        return { success: true };
    } catch (error) {
        console.error("Error accepting friend request:", error);
        return { error: "Failed to accept friend request" };
    }
}

// Reject or cancel a friend request
export async function rejectFriendRequest(relationId: bigint) {
    const { userId } = await auth();
    if (!userId) {
        return { error: "Not authenticated" };
    }

    try {
        const relation = await db
            .select()
            .from(friends)
            .where(
                and(
                    eq(friends.id, relationId),
                    or(
                        eq(friends.friendId, userId),
                        eq(friends.userId, userId),
                    ),
                    eq(friends.status, "pending"),
                ),
            );

        if (relation.length === 0) {
            return { error: "Friend request not found" };
        }

        // Delete the friend request
        await db.delete(friends).where(eq(friends.id, relationId));

        revalidatePath("/friends");
        return { success: true };
    } catch (error) {
        console.error("Error rejecting friend request:", error);
        return { error: "Failed to reject friend request" };
    }
}

// Remove a friend
export async function removeFriend(relationId: bigint) {
    const { userId } = await auth();
    if (!userId) {
        return { error: "Not authenticated" };
    }

    try {
        // Find the friend relationship to remove
        const relation = await db
            .select({
                id: friends.id,
                userId: friends.userId,
                friendId: friends.friendId,
                status: friends.status,
            })
            .from(friends)
            .where(
                and(
                    eq(friends.id, relationId),
                    or(
                        eq(friends.friendId, userId),
                        eq(friends.userId, userId),
                    ),
                    eq(friends.status, "accepted"),
                ),
            );

        if (relation.length === 0) {
            return { error: "Friend relationship not found" };
        }

        const friendRelation = relation[0]!;

        // Determine the other user's ID
        const otherUserId =
            friendRelation.userId === userId
                ? friendRelation.friendId
                : friendRelation.userId;

        // Delete the current relationship
        await db.delete(friends).where(eq(friends.id, relationId));

        // Delete the inverse relationship if it exists
        await db
            .delete(friends)
            .where(
                and(
                    or(
                        and(
                            eq(friends.userId, userId),
                            eq(friends.friendId, otherUserId),
                        ),
                        and(
                            eq(friends.userId, otherUserId),
                            eq(friends.friendId, userId),
                        ),
                    ),
                    eq(friends.status, "accepted"),
                ),
            );

        revalidatePath("/friends");
        return { success: true };
    } catch (error) {
        console.error("Error removing friend:", error);
        return { error: "Failed to remove friend" };
    }
}
